"""Failed sign-in lockout shared by every API worker and instance (V-13).

The in-memory rate limiter is per process, so with several workers and no Redis an attacker got N x the limit. These
counters live in Postgres (table login_failures, migration 0005), keyed by sha256(lower(email)):

* LOGIN_MAX_FAILURES (default 8) wrong passwords inside LOGIN_FAILURE_WINDOW_MINUTES (default 15) lock the account's
  sign-in for LOGIN_LOCK_MINUTES (default 15). A successful sign-in clears the counter.
* Everything here is best effort: if the table is missing or the database errors, sign-in is NOT blocked (the
  per-process limiter still applies). All functions are blocking: call them through asyncio.to_thread.
"""

from __future__ import annotations

import hashlib
import logging
import os

logger = logging.getLogger("hireright.login_guard")


def _int_env(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name) or default))
    except ValueError:
        return default


def max_failures() -> int:
    return _int_env("LOGIN_MAX_FAILURES", 8)


def window_minutes() -> int:
    return _int_env("LOGIN_FAILURE_WINDOW_MINUTES", 15)


def lock_minutes() -> int:
    return _int_env("LOGIN_LOCK_MINUTES", 15)


def email_hash(email: str) -> str:
    return hashlib.sha256(str(email or "").strip().lower().encode("utf-8")).hexdigest()


def _pool(database_url: str):
    from app.db.dynamo_config import database_provider

    if not database_url or database_provider() == "dynamodb":
        return None
    from app.db import store

    store._ensure_schema(database_url)
    return store.db_pool(database_url)


def is_locked(database_url: str, email: str) -> bool:
    try:
        pool = _pool(database_url)
        if pool is None:
            return False
        with pool.connection() as conn:
            row = conn.execute(
                "SELECT 1 AS locked FROM login_failures WHERE email_hash = %s AND locked_until > NOW()",
                (email_hash(email),),
            ).fetchone()
        return bool(row)
    except Exception:
        logger.warning("login lockout check failed; not blocking sign-in", exc_info=True)
        return False


def record_failure(database_url: str, email: str) -> bool:
    """Count one failed sign-in. Returns True when this failure locked the account."""
    try:
        pool = _pool(database_url)
        if pool is None:
            return False
        with pool.connection() as conn:
            row = conn.execute(
                """INSERT INTO login_failures (email_hash, failures, window_start, updated_at)
                   VALUES (%(h)s, 1, NOW(), NOW())
                   ON CONFLICT (email_hash) DO UPDATE SET
                     failures = CASE
                       WHEN login_failures.window_start < NOW() - make_interval(mins => %(win)s) THEN 1
                       ELSE login_failures.failures + 1 END,
                     window_start = CASE
                       WHEN login_failures.window_start < NOW() - make_interval(mins => %(win)s) THEN NOW()
                       ELSE login_failures.window_start END,
                     updated_at = NOW()
                   RETURNING failures""",
                {"h": email_hash(email), "win": window_minutes()},
            ).fetchone()
            failures = int((row or {}).get("failures") or 0) if isinstance(row, dict) else int((row or [0])[0] or 0)
            locked = failures >= max_failures()
            if locked:
                conn.execute(
                    """UPDATE login_failures SET locked_until = NOW() + make_interval(mins => %s), failures = 0,
                              window_start = NOW()
                       WHERE email_hash = %s""",
                    (lock_minutes(), email_hash(email)),
                )
            conn.commit()
        return locked
    except Exception:
        logger.warning("could not record a failed sign-in", exc_info=True)
        return False


def clear(database_url: str, email: str) -> None:
    try:
        pool = _pool(database_url)
        if pool is None:
            return
        with pool.connection() as conn:
            conn.execute("DELETE FROM login_failures WHERE email_hash = %s", (email_hash(email),))
            conn.commit()
    except Exception:
        logger.warning("could not clear sign-in failures", exc_info=True)
