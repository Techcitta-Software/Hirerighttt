"""Scheduled clean-up: expired credentials always, old recordings/audit rows when a retention period is set.

Environment (all optional):
  RECORDING_RETENTION_DAYS   delete interview recordings + transcripts/report PDFs older than this (default: keep)
  AUDIT_RETENTION_DAYS       delete audit rows older than this (default 730 = two years)
Expired sessions and used/expired password-reset tokens are always removed.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from app.db.row_utils import row_value

logger = logging.getLogger("hireright.retention")


def _days(name: str, default: int | None) -> int | None:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        logger.warning("%s=%r is not a number; ignoring", name, raw)
        return default
    return value if value > 0 else default


def purge_expired(pool: Any, *, delete_object=None) -> dict[str, int]:
    """Run every sweep and return how many rows/objects each removed.

    `delete_object(key)` removes one S3 object; pass None to skip object deletion (rows are then kept so the
    file is not orphaned and can be retried on the next run).
    """
    from app.db.dynamo_config import database_provider

    if database_provider() == "dynamodb":
        from app.db import dynamo_repos as dr

        return dr.purge_expired_dynamo(delete_object=delete_object)
    counts = {"sessions": 0, "reset_tokens": 0, "audit_rows": 0, "recordings": 0, "artifacts": 0}
    with pool.connection() as conn:
        counts["sessions"] = conn.execute("DELETE FROM hireright_sessions WHERE expires_at < NOW()").rowcount or 0
        try:  # failed sign-in counters (migration 0005) older than a day are no longer relevant
            with conn.transaction():
                conn.execute("DELETE FROM login_failures WHERE updated_at < NOW() - INTERVAL '1 day'")
        except Exception:
            pass
        counts["reset_tokens"] = (
            conn.execute(
                "DELETE FROM password_reset_tokens WHERE used_at IS NOT NULL OR expires_at < NOW() - INTERVAL '1 day'"
            ).rowcount
            or 0
        )
        audit_days = _days("AUDIT_RETENTION_DAYS", 730)
        if audit_days:
            counts["audit_rows"] = (
                conn.execute(
                    "DELETE FROM audit_logs WHERE created_at < NOW() - make_interval(days => %s)", (audit_days,)
                ).rowcount
                or 0
            )
        conn.commit()

    media_days = _days("RECORDING_RETENTION_DAYS", None)
    if media_days and delete_object is not None:
        for table, key in (("interview_recordings", "recordings"), ("interview_artifacts", "artifacts")):
            with pool.connection() as conn:
                rows = conn.execute(
                    f"SELECT id, s3_object_key FROM {table} WHERE created_at < NOW() - make_interval(days => %s) LIMIT 500",
                    (media_days,),
                ).fetchall()
            for row in rows:
                row_id, object_key = row_value(row, "id", 0), row_value(row, "s3_object_key", 1)
                try:
                    delete_object(object_key)
                except Exception:
                    logger.warning("Could not delete %s for %s %s; will retry", object_key, table, row_id, exc_info=True)
                    continue
                with pool.connection() as conn:
                    conn.execute(f"DELETE FROM {table} WHERE id = %s", (row_id,))
                    conn.commit()
                counts[key] += 1
    return counts
