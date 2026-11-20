"""Rate limiting that survives restarts and works across several API instances.

With REDIS_URL set, counters live in Redis (fixed window: INCR + EXPIRE). Without it — local dev, tests — the
per-process sliding window below is used. If Redis is configured but unreachable the limiter fails OPEN to the
in-memory window, so a Redis outage can never lock every user out of logging in.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any

logger = logging.getLogger("hireright.ratelimit")

_buckets: dict[str, list[float]] = {}
_SWEEP_AT = 5000  # distinct keys before stale ones are swept

_redis: Any = None
_redis_checked = False
_redis_down_until = 0.0


def _sweep(now_ms: float) -> None:
    for k in [k for k, b in _buckets.items() if not b or now_ms - b[-1] > 3_600_000]:
        _buckets.pop(k, None)


def _memory_allow(key: str, limit: int, window_ms: int) -> bool:
    now = time.time() * 1000
    if len(_buckets) > _SWEEP_AT:
        _sweep(now)
    bucket = [t for t in _buckets.get(key, []) if now - t < window_ms]
    if len(bucket) >= limit:
        return False
    bucket.append(now)
    _buckets[key] = bucket
    return True


def _client() -> Any:
    """Lazily build the Redis client; None when REDIS_URL is unset or the client library is missing."""
    global _redis, _redis_checked
    if _redis_checked:
        return _redis
    _redis_checked = True
    url = (os.environ.get("REDIS_URL") or "").strip()
    if not url:
        return None
    try:
        import redis  # type: ignore[import-not-found]

        _redis = redis.Redis.from_url(url, socket_connect_timeout=1.5, socket_timeout=1.5, decode_responses=True)
        logger.info("Rate limiter: using Redis")
    except Exception:
        logger.warning("REDIS_URL is set but Redis could not be initialised; using in-memory rate limits", exc_info=True)
        _redis = None
    return _redis


def reset_for_tests() -> None:
    global _redis, _redis_checked, _redis_down_until
    _buckets.clear()
    _redis = None
    _redis_checked = False
    _redis_down_until = 0.0


def _worker_count() -> int:
    try:
        return max(1, int(os.environ.get("WEB_CONCURRENCY") or 1))
    except ValueError:
        return 1


def shared_backend_available() -> bool:
    """True when counters are shared by every worker / instance (Redis configured and not backed off)."""
    return _client() is not None and time.time() >= _redis_down_until


def allow(key: str, limit: int = 30, window_ms: int = 60_000, *, strict: bool = False) -> bool:
    """True if this call is within `limit` calls per `window_ms` for `key`.

    strict=True is for security-sensitive limits (login, password reset, signup). Without a shared Redis each worker
    process counts on its own, so N workers would allow N x `limit`; strict limits are divided by WEB_CONCURRENCY in
    that case, keeping the total across all workers at (about) `limit`.
    """
    global _redis_down_until
    client = _client()
    if client is not None and time.time() >= _redis_down_until:
        try:
            redis_key = f"rl:{key}"
            count = client.incr(redis_key)
            if count == 1:
                client.pexpire(redis_key, window_ms)
            elif client.pttl(redis_key) < 0:  # an INCR that raced the EXPIRE would otherwise never expire
                client.pexpire(redis_key, window_ms)
            return int(count) <= limit
        except Exception:
            # Back off for 30s so a dead Redis does not add a timeout to every request.
            _redis_down_until = time.time() + 30
            logger.warning("Redis rate limiter unavailable; falling back to in-memory limits for 30s", exc_info=True)
    if strict:
        limit = max(1, limit // _worker_count())
    return _memory_allow(key, limit, window_ms)
