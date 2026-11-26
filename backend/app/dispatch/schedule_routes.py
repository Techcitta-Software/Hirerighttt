"""Interview slot reminders and candidate self-service rescheduling.

Industry practice for scheduled interviews: a confirmation at booking (sent by
/api/interview/confirmation-email), a reminder about 24 hours before and again about
2 hours before, and a one-click way for the candidate to move a slot they booked.

Routes
- POST /api/interview-invites/{token}/reschedule   (signed-in invitee, self-booked invites only)
- POST /api/internal/interview-reminders           (called by a scheduler; needs X-Cron-Secret)
"""

from __future__ import annotations

from app.db.finders import find_user
import asyncio
import hmac
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from fastapi import Request
from fastapi.responses import JSONResponse, Response

from app.db import store as db_store
from app.db.persistence import persistence_ready
from app.dispatch.context import DispatchContext
from app.node_config import config
from app.server import runtime
from app.services.candidate_name import candidate_display_name
from app.services.interview_integrity import invite_attempt_used
from app.services.interview_invites import (
    build_interview_invite_email,
    get_interview_invite_by_token,
    invite_join_window_end,
    invite_public_url,
    trusted_request_origin,
)
from app.services.mail_service import send_mail, smtp_configured

logger = logging.getLogger("hireright.schedule")

MAX_RESCHEDULES = 3
MIN_LEAD = timedelta(minutes=15)
MAX_AHEAD = timedelta(days=30)
# Do not send a "reminder" right after the confirmation email for a slot booked at short notice.
QUIET_AFTER_BOOKING = timedelta(minutes=45)

_RESCHEDULE_PATH = re.compile(r"^/api/interview-invites/([A-Za-z0-9]+)/reschedule$")


def _dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    # An offset-less time is UTC; a naive value compared with the aware "now" below raised TypeError (500).
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def reminder_kind(invite: dict, now: datetime) -> str | None:
    """Which reminder (if any) is due for this invite right now: "24h", "2h" or None."""
    start = _dt(invite.get("scheduled_start"))
    end = _dt(invite.get("scheduled_end"))
    created = _dt(invite.get("created_at")) or (start - timedelta(days=2) if start else None)
    if not start or not end:
        return None
    # Open links (valid for days) are not slot bookings.
    if (end - start) > timedelta(hours=24):
        return None
    until = start - now
    if until <= timedelta(0):
        return None
    if created and now - created < QUIET_AFTER_BOOKING:
        return None
    if until <= timedelta(hours=2):
        return None if invite.get("reminder_2h_sent_at") else "2h"
    if until <= timedelta(hours=24):
        return None if invite.get("reminder_24h_sent_at") else "24h"
    return None


def reschedule_refusal(invite: dict | None, user: dict | None, db: dict) -> str | None:
    """Why this candidate may not move this slot, or None when they may."""
    if not invite or not user:
        return "Invitation not found."
    if str(invite.get("candidate_email") or "").strip().lower() != str(user.get("email") or "").strip().lower():
        return "Sign in with the email address that received this invitation."
    if invite.get("application_id") or (invite.get("created_by_user_id") and invite.get("created_by_user_id") != user.get("id")):
        return "This interview was scheduled by the recruiter. Ask them for a new time."
    if invite_attempt_used(db, str(invite.get("token") or "")):
        return "You have already completed this interview."
    if int(invite.get("reschedule_count") or 0) >= MAX_RESCHEDULES:
        return f"This slot has already been moved {MAX_RESCHEDULES} times. Book a new interview from your dashboard."
    return None


def _reminder_email(invite: dict, kind: str) -> dict[str, str]:
    mail = build_interview_invite_email(
        candidateName=invite.get("candidate_name"),
        jobTitle=invite.get("job_title"),
        scheduledStart=_dt(invite["scheduled_start"]).isoformat(),
        scheduledEnd=_dt(invite["scheduled_end"]).isoformat(),
        durationMinutes=20,
        inviteUrl=invite_public_url(str(invite["token"])),
    )
    when = "tomorrow" if kind == "24h" else "in about 2 hours"
    mail["subject"] = f"Reminder: your AI interview is {when}"
    return mail


def _current_resume_name(pool, invite: dict) -> str:
    """The name on the candidate's current resume (it may have been replaced after the invite was created)."""
    from app.services.candidate_name import resume_name

    try:
        with pool.connection() as conn:
            row = conn.execute(
                "SELECT data FROM profiles WHERE lower(email) = lower(%s)", (str(invite.get("candidate_email") or ""),)
            ).fetchone()
    except Exception:
        return ""
    data = (row.get("data") if isinstance(row, dict) else (row[0] if row else None)) if row else None
    return resume_name(data if isinstance(data, dict) else {})


def record_due_reminders(pool, now: datetime | None = None) -> dict[str, int]:
    """Email is off: record which reminder is due on each slot (no email) so the app can show "reminder due".

    Each kind is recorded once per slot; the *_sent_at columns stay empty, so the email still goes out if email is
    configured before the slot."""
    now = now or datetime.now(timezone.utc)
    recorded = {"24h": 0, "2h": 0}
    with pool.connection() as conn:
        rows = conn.execute(
            """SELECT * FROM interview_invites
               WHERE scheduled_start > %s AND scheduled_start <= %s
                 AND (reminder_24h_sent_at IS NULL OR reminder_2h_sent_at IS NULL)""",
            (now, now + timedelta(hours=24)),
        ).fetchall()
        for row in rows:
            invite = dict(row)
            kind = reminder_kind(invite, now)
            if not kind:
                continue
            got = conn.execute(
                """UPDATE interview_invites SET reminder_due_kind = %s, reminder_due_at = %s
                   WHERE token = %s AND reminder_due_kind IS DISTINCT FROM %s RETURNING token""",
                (kind, now, invite["token"], kind),
            ).fetchone()
            if got:
                recorded[kind] += 1
        conn.commit()
    return recorded


async def send_due_reminders(pool, now: datetime | None = None) -> dict[str, int]:
    now = now or datetime.now(timezone.utc)
    def _due_rows():
        with pool.connection() as conn:
            return conn.execute(
                """SELECT * FROM interview_invites
                   WHERE scheduled_start > %s AND scheduled_start <= %s
                     AND (reminder_24h_sent_at IS NULL OR reminder_2h_sent_at IS NULL)""",
                (now, now + timedelta(hours=24)),
            ).fetchall()

    rows = await asyncio.to_thread(_due_rows)
    sent = {"24h": 0, "2h": 0, "failed": 0}
    for row in rows:
        invite = dict(row)
        kind = reminder_kind(invite, now)
        if not kind:
            continue
        column = "reminder_24h_sent_at" if kind == "24h" else "reminder_2h_sent_at"
        # Claim the reminder first so two scheduler runs never send it twice.
        def _claim(col=column, tok=invite["token"]):
            with pool.connection() as conn:
                got = conn.execute(
                    f"UPDATE interview_invites SET {col} = NOW() WHERE token = %s AND {col} IS NULL RETURNING token",
                    (tok,),
                ).fetchone()
                conn.commit()
                return got

        claimed = await asyncio.to_thread(_claim)
        if not claimed:
            continue
        try:
            invite["candidate_name"] = await asyncio.to_thread(_current_resume_name, pool, invite) or invite.get("candidate_name")
            mail = _reminder_email(invite, kind)
            await send_mail(to=invite["candidate_email"], subject=mail["subject"], html=mail["html"], text=mail.get("text"))
            sent[kind] += 1
        except Exception:
            logger.exception("Reminder email failed for invite %s", str(invite["token"])[:8])
            sent["failed"] += 1

            def _unclaim(col=column, tok=invite["token"]):
                with pool.connection() as conn:
                    conn.execute(f"UPDATE interview_invites SET {col} = NULL WHERE token = %s", (tok,))
                    conn.commit()

            await asyncio.to_thread(_unclaim)
    return sent


async def try_schedule_routes(
    request: Request, ctx: DispatchContext, json_fn: Callable[..., JSONResponse]
) -> Response | None:
    path = request.url.path
    method = request.method.upper()

    if method == "POST" and path == "/api/internal/interview-reminders":
        secret = os.environ.get("CRON_SECRET") or ""
        given = request.headers.get("x-cron-secret") or ""
        if not secret or not hmac.compare_digest(secret.encode(), given.encode("utf-8", "replace")):
            return json_fn(401, {"error": "Unauthorized"})
        if not persistence_ready(config.database_url):
            return json_fn(503, {"error": "Database must be configured."})
        pool = db_store.db_pool(config.database_url)
        if not smtp_configured():
            # No email provider: record the due reminders so the recruiter's invite status and the candidate's
            # invite page show "reminder due" instead of the reminder silently never happening.
            recorded = await asyncio.to_thread(record_due_reminders, pool)
            return json_fn(
                200, {"ok": True, "emailConfigured": False, "sent": {"24h": 0, "2h": 0, "failed": 0}, "recorded": recorded}
            )
        sent = await send_due_reminders(pool)
        return json_fn(200, {"ok": True, "emailConfigured": True, "sent": sent})

    if method == "POST" and path == "/api/internal/maintenance":
        secret = os.environ.get("CRON_SECRET") or ""
        given = request.headers.get("x-cron-secret") or ""
        if not secret or not hmac.compare_digest(secret.encode(), given.encode("utf-8", "replace")):
            return json_fn(401, {"error": "Unauthorized"})
        if not persistence_ready(config.database_url):
            return json_fn(503, {"error": "Database must be configured."})
        from app.services import audit, retention
        from app.services.storage.s3_storage import delete_object, object_storage_configured

        counts = await asyncio.to_thread(
            retention.purge_expired,
            db_store.db_pool(config.database_url),
            delete_object=delete_object if object_storage_configured() else None,
        )
        await audit.record_async(audit.DATA_PURGED, meta=counts)
        return json_fn(200, {"ok": True, "purged": counts})

    match = _RESCHEDULE_PATH.match(path)
    if method == "POST" and match:
        email = await runtime.require_auth_email(request)
        if not ctx.rate_limit(f"resched:{email}", 6, 3_600_000):
            return json_fn(429, {"error": "Too many changes. Try again later."})
        body = await runtime.read_json_body(request)
        if not persistence_ready(config.database_url):
            return json_fn(503, {"error": "Database required."})
        pool = db_store.db_pool(config.database_url)
        token = match.group(1)
        invite = await get_interview_invite_by_token(pool, token)
        db = ctx.load_db()
        user = await asyncio.to_thread(find_user, db, email=email)
        refusal = await asyncio.to_thread(reschedule_refusal, invite, user, db)
        if refusal:
            return json_fn(403, {"error": refusal, "code": "RESCHEDULE_NOT_ALLOWED"})
        start = _dt(body.get("scheduledStart"))
        now = datetime.now(timezone.utc)
        if not start:
            return json_fn(400, {"error": "Choose a new date and time."})
        if start < now + MIN_LEAD:
            return json_fn(400, {"error": "Pick a time at least 15 minutes from now."})
        if start > now + MAX_AHEAD:
            return json_fn(400, {"error": "Pick a time within the next 30 days."})
        end = invite_join_window_end(start)
        def _move() -> None:
            with pool.connection() as conn:
                conn.execute(
                    """UPDATE interview_invites
                       SET scheduled_start = %s, scheduled_end = %s, reschedule_count = COALESCE(reschedule_count, 0) + 1,
                           reminder_24h_sent_at = NULL, reminder_2h_sent_at = NULL
                       WHERE token = %s""",
                    (start, end, token),
                )
                conn.commit()

        await asyncio.to_thread(_move)
        email_sent = False
        if smtp_configured():
            try:
                mail = build_interview_invite_email(
                    candidateName=candidate_display_name(db, email, given=invite.get("candidate_name")),
                    jobTitle=invite.get("job_title"),
                    scheduledStart=start.isoformat(),
                    scheduledEnd=end.isoformat(),
                    durationMinutes=20,
                    inviteUrl=invite_public_url(token, trusted_request_origin(request)),
                )
                mail["subject"] = "Rescheduled: " + mail["subject"].replace("Booking confirmed: ", "")
                await send_mail(to=email, subject=mail["subject"], html=mail["html"], text=mail.get("text"))
                email_sent = True
            except Exception:
                logger.exception("Reschedule email failed for invite %s", token[:8])
        await asyncio.sleep(0)
        return json_fn(
            200,
            {
                "ok": True,
                "scheduledStart": start.isoformat().replace("+00:00", "Z"),
                "scheduledEnd": end.isoformat().replace("+00:00", "Z"),
                "emailSent": email_sent,
                "reschedulesLeft": MAX_RESCHEDULES - int(invite.get("reschedule_count") or 0) - 1,
            },
        )

    return None
