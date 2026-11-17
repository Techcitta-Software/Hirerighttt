"""Append-only audit trail (audit_logs table) for security-relevant actions.

Writing an audit row must never break the request it describes, so every failure is logged and swallowed.
Never put passwords, tokens or interview content in `meta`; record who did what to which entity, from where.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.node_config import config

logger = logging.getLogger("hireright.audit")

# Actions in use — keep them stable, dashboards and retention rules key off them.
LOGIN_OK = "auth.login"
LOGIN_FAILED = "auth.login_failed"
LOGOUT = "auth.logout"
PASSWORD_RESET = "auth.password_reset"
RECORDING_VIEWED = "recording.viewed"
INVITE_CREATED = "invite.created"
DATA_PURGED = "retention.purged"


def record(
    action: str,
    *,
    user_id: str | None = None,
    organization_id: str | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    meta: dict[str, Any] | None = None,
) -> None:
    """Synchronous insert; call from async code with `await asyncio.to_thread(audit.record, ...)`."""
    try:
        from app.db.dynamo_config import database_provider

        if database_provider() == "dynamodb":
            from app.db import dynamo_repos as dr

            dr.audit_record_dynamo(
                action,
                user_id=user_id,
                organization_id=organization_id,
                entity_type=entity_type,
                entity_id=entity_id,
                meta=meta,
            )
            return
        if not config.database_url.strip():
            return
        from app.db import store as db_store

        pool = db_store.db_pool(config.database_url)
        with pool.connection() as conn:
            conn.execute(
                """INSERT INTO audit_logs (organization_id, user_id, action, entity_type, entity_id, meta)
                   VALUES (%s, %s, %s, %s, %s, %s::jsonb)""",
                (organization_id, user_id, action, entity_type, entity_id, json.dumps(meta or {}, default=str)),
            )
            conn.commit()
    except Exception:
        logger.warning("Could not write audit log %s", action, exc_info=True)


async def record_async(action: str, **kwargs: Any) -> None:
    import asyncio

    await asyncio.to_thread(record, action, **kwargs)


_pending: set = set()


def fire(action: str, **kwargs: Any) -> None:
    """Record in the background so a slow database never adds latency to the request being audited."""
    import asyncio

    try:
        task = asyncio.get_running_loop().create_task(record_async(action, **kwargs))
    except RuntimeError:  # no running loop (sync caller / tests)
        record(action, **kwargs)
        return
    _pending.add(task)
    task.add_done_callback(_pending.discard)


def email_fingerprint(email: str) -> str:
    """Stable, non-reversible handle for an address, so failed logins can be correlated without storing it."""
    import hashlib

    return hashlib.sha256((email or "").strip().lower().encode("utf-8")).hexdigest()[:16]
