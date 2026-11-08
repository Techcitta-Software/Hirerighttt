"""Interview slot reminders and candidate self-service rescheduling.

Industry practice for scheduled interviews: a confirmation at booking (sent by
/api/interview/confirmation-email), a reminder about 24 hours before and again about
2 hours before, and a one-click way for the candidate to move a slot they booked.

Routes
- POST /api/interview-invites/{token}/reschedule   (signed-in invitee, self-booked invites only)
- POST /api/internal/interview-reminders           (called by a scheduler; needs X-Cron-Secret)
"""

from __future__ import annotations

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
from app.dispatch.context import DispatchContext
from app.node_config import config
from app.server import runtime
from app.services.interview_integrity import invite_attempt_used
from app.services.interview_invites import (
    build_interview_invite_email,
    get_interview_invite_by_token,
    invite_join_window_end,
    invite_public_url,
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
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


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


async def send_due_reminders(pool, now: datetime | None = None) -> dict[str, int]:
    now = now or datetime.now(timezone.utc)
    with pool.connection() as conn:
        rows = conn.execute(
            """SELECT * FROM interview_invites
               WHERE scheduled_start > %s AND scheduled_start <= %s
                 AND (reminder_24h_sent_at IS NULL OR reminder_2h_sent_at IS NULL)""",
            (now, now + timedelta(hours=24)),
        ).fetchall()
    sent = {"24h": 0, "2h": 0, "failed": 0}
    for row in rows:
        invite = dict(row)
        kind = reminder_kind(invite, now)
        if not kind:
            continue
        column = "reminder_24h_sent_at" if kind == "24h" else "reminder_2h_sent_at"
        # Claim the reminder first so two scheduler runs never send it twice.
        with pool.connection() as conn:
            claimed = conn.execute(
                f"UPDATE interview_invites SET {column} = NOW() WHERE token = %s AND {column} IS NULL RETURNING token",
                (invite["token"],),
            ).fetchone()
            conn.commit()
        if not claimed:
            continue
        try:
            mail = _reminder_email(invite, kind)
            await send_mail(to=invite["candidate_email"], subject=mail["subject"], html=mail["html"], text=mail.get("text"))
            sent[kind] += 1
        except Exception:
            logger.exception("Reminder email failed for invite %s", str(invite["token"])[:8])
            sent["failed"] += 1
            with pool.connection() as conn:
                conn.execute(f"UPDATE interview_invites SET {column} = NULL WHERE token = %s", (invite["token"],))
                conn.commit()
    return sent


async def try_schedule_routes(
    request: Request, ctx: DispatchContext, json_fn: Callable[..., JSONResponse]
) -> Response | None:
    path = request.url.path
    method = request.method.upper()

    if method == "POST" and path == "/api/internal/interview-reminders":
        secret = os.environ.get("CRON_SECRET") or ""
        given = request.headers.get("x-cron-secret") or ""
        if not secret or not hmac.compare_digest(secret, given):
            return json_fn(401, {"error": "Unauthorized"})
        if not config.database_url or not smtp_configured():
            return json_fn(503, {"error": "Database and email must be configured."})
        sent = await send_due_reminders(db_store.db_pool(config.database_url))
        return json_fn(200, {"ok": True, "sent": sent})

    match = _RESCHEDULE_PATH.match(path)
    if method == "POST" and match:
        email = await runtime.require_auth_email(request)
        if not ctx.rate_limit(f"resched:{email}", 6, 3_600_000):
            return json_fn(429, {"error": "Too many changes. Try again later."})
        body = await runtime.read_json_body(request)
        if not config.database_url:
            return json_fn(503, {"error": "Database required."})
        pool = db_store.db_pool(config.database_url)
        token = match.group(1)
        invite = await get_interview_invite_by_token(pool, token)
        db = ctx.load_db()
        user = next((u for u in db.get("users") or [] if u.get("email") == email), None)
        refusal = reschedule_refusal(invite, user, db)
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
        with pool.connection() as conn:
            conn.execute(
                """UPDATE interview_invites
                   SET scheduled_start = %s, scheduled_end = %s, reschedule_count = COALESCE(reschedule_count, 0) + 1,
                       reminder_24h_sent_at = NULL, reminder_2h_sent_at = NULL
                   WHERE token = %s""",
                (start, end, token),
            )
            conn.commit()
        email_sent = False
        if smtp_configured():
            try:
                mail = build_interview_invite_email(
                    candidateName=invite.get("candidate_name"),
                    jobTitle=invite.get("job_title"),
                    scheduledStart=start.isoformat(),
                    scheduledEnd=end.isoformat(),
                    durationMinutes=20,
                    inviteUrl=invite_public_url(token),
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
