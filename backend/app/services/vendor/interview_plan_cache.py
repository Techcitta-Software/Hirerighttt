"""Short-lived cache for the recruiter's interview-plan preview (GET /api/vendor/applicants/{id}/interview-plan).

The preview is one Gemini call (2-5 s). It used to run again on every open of the same applicant. The key covers
everything the questions are built from (application, job text / skills / role / level, the resume and the skill
focus), so any change to the job or the resume produces a new key: the old entry is simply never read again and ages
out. Entries live 30 minutes; the cache is bounded (LRU). Concurrent opens of the same applicant share one call.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import threading
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from typing import Any

TTL_S = 30 * 60.0
MAX_ENTRIES = 512

_lock = threading.Lock()
_entries: OrderedDict[str, tuple[float, dict]] = OrderedDict()
_inflight: dict[str, asyncio.Future] = {}


def plan_cache_key(**parts: Any) -> str:
    blob = json.dumps(parts, sort_keys=True, default=str, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8", "ignore")).hexdigest()


def get(key: str) -> dict | None:
    with _lock:
        hit = _entries.get(key)
        if not hit:
            return None
        at, value = hit
        if time.monotonic() - at > TTL_S:
            _entries.pop(key, None)
            return None
        _entries.move_to_end(key)
        return copy.deepcopy(value)


def put(key: str, value: dict) -> None:
    with _lock:
        _entries[key] = (time.monotonic(), copy.deepcopy(value))
        _entries.move_to_end(key)
        while len(_entries) > MAX_ENTRIES:
            _entries.popitem(last=False)


def clear() -> None:
    with _lock:
        _entries.clear()


async def get_or_build(key: str, build: Callable[[], Awaitable[dict]], *, refresh: bool = False) -> tuple[dict, bool]:
    """(payload, from_cache). Failures are not cached."""
    if not refresh:
        cached = get(key)
        if cached is not None:
            return cached, True
        running = _inflight.get(key)
        if running is not None:
            return copy.deepcopy(await asyncio.shield(running)), False
    fut: asyncio.Future = asyncio.get_running_loop().create_future()
    _inflight[key] = fut
    try:
        value = await build()
    except BaseException as err:
        if not fut.done():
            if isinstance(err, Exception):
                fut.set_exception(err)
                fut.exception()  # mark retrieved: waiters re-raise it, nobody else needs to
            else:
                fut.cancel()  # the first caller went away (client disconnected / shutdown)
        raise
    else:
        put(key, value)
        if not fut.done():
            fut.set_result(value)
        return copy.deepcopy(value), False
    finally:
        if _inflight.get(key) is fut:
            _inflight.pop(key, None)
