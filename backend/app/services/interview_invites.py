from __future__ import annotations

import html
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

from app.services.mail_service import send_mail, smtp_configured

configured_join = int(os.environ.get("INVITE_JOIN_WINDOW_MINUTES") or 5)
INVITE_JOIN_WINDOW_MINUTES = min(30, max(1, configured_join if configured_join == configured_join else 5))


def invite_join_window_end(scheduled_start: datetime | str, join_minutes: int = INVITE_JOIN_WINDOW_MINUTES) -> datetime:
    start = scheduled_start if isinstance(scheduled_start, datetime) else datetime.fromisoformat(str(scheduled_start).replace("Z", "+00:00"))
    return start + timedelta(minutes=join_minutes)


def new_invite_token() -> str:
    return secrets.token_hex(24)


def parse_invite_context(row: dict) -> dict:
    raw = row.get("context_json")
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        return json.loads(str(raw))
    except Exception:
        return {}


async def insert_interview_invite(pool, row: dict) -> None:
    with pool.connection() as conn:
        conn.execute(
            """INSERT INTO interview_invites
              (token, organization_id, application_id, job_id, candidate_email, candidate_name, job_title,
               scheduled_start, scheduled_end, created_by_user_id, email_sent_at, context_json)
             VALUES (%s,%s,%s,%s,%s,%s,%s,%s::timestamptz,%s::timestamptz,%s,%s::timestamptz,%s::jsonb)""",
            (
                row["token"],
                row.get("organizationId"),
                row.get("applicationId"),
                row.get("jobId"),
                row["candidateEmail"],
                row.get("candidateName"),
                row.get("jobTitle"),
                row["scheduledStart"],
                row["scheduledEnd"],
                row.get("createdByUserId"),
                row.get("emailSentAt"),
                json.dumps(row.get("contextJson") or {}),
            ),
        )
        conn.commit()


async def get_interview_invite_by_token(pool, token: str) -> dict | None:
    with pool.connection() as conn:
        row = conn.execute("SELECT * FROM interview_invites WHERE token = %s", (token,)).fetchone()
    return dict(row) if row else None


def invite_access_state(invite: dict, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    start = invite.get("scheduled_start")
    end = invite.get("scheduled_end")
    start_dt = start if isinstance(start, datetime) else datetime.fromisoformat(str(start).replace("Z", "+00:00"))
    end_dt = end if isinstance(end, datetime) else datetime.fromisoformat(str(end).replace("Z", "+00:00"))
    if end_dt <= start_dt:
        return {"status": "invalid", "canStart": False, "scheduledStart": None, "scheduledEnd": None}
    if now.timestamp() < start_dt.timestamp():
        return {"status": "too_early", "canStart": False, "scheduledStart": start_dt, "scheduledEnd": end_dt}
    if now.timestamp() >= end_dt.timestamp():
        return {"status": "expired", "canStart": False, "scheduledStart": start_dt, "scheduledEnd": end_dt}
    return {"status": "open", "canStart": True, "scheduledStart": start_dt, "scheduledEnd": end_dt}


def validate_invite_start(invite: dict | None, candidate_email: str, now: datetime | None = None) -> dict:
    if not invite:
        return {"ok": False, "status": 404, "error": "This invitation was not found. Ask for a new link."}
    if str(invite.get("candidate_email") or "").strip().lower() != str(candidate_email).strip().lower():
        return {"ok": False, "status": 403, "error": "Sign in with the email address that received this invitation."}
    access = invite_access_state(invite, now)
    if not access.get("canStart"):
        if access.get("status") == "too_early":
            return {"ok": False, "status": 409, "error": "Your interview has not opened yet. Return at the scheduled time."}
        return {"ok": False, "status": 410, "error": "This invitation has expired or is invalid. Ask for a new link."}
    return {"ok": True}


def public_app_origin() -> str:
    explicit = next(
        (os.environ.get(k) for k in ("PUBLIC_APP_URL", "FRONTEND_URL", "APP_URL") if os.environ.get(k)),
        None,
    )
    if explicit:
        u = urlparse(explicit.strip())
        if u.scheme in ("http", "https") and u.path in ("", "/"):
            return u.scheme + "://" + u.netloc
    if os.environ.get("NODE_ENV") != "production":
        return "http://localhost:5173"
    raise RuntimeError("PUBLIC_APP_URL is required to create working email links in production.")


def invite_public_url(token: str) -> str:
    return f"{public_app_origin()}/interview/invite/{token}"


def build_interview_invite_email(**kwargs) -> dict[str, str]:
    start = datetime.fromisoformat(str(kwargs["scheduledStart"]).replace("Z", "+00:00"))
    end_raw = kwargs.get("scheduledEnd")
    end = datetime.fromisoformat(str(end_raw).replace("Z", "+00:00")) if end_raw else invite_join_window_end(start)
    invite_url = kwargs["inviteUrl"]
    job_title = kwargs.get("jobTitle") or ""
    candidate_name = kwargs.get("candidateName") or ""
    subject = f"Booking confirmed: AI interview{' for ' + job_title if job_title else ''}"
    greeting = f"Hi {html.escape(candidate_name)}," if candidate_name else "Hi,"
    html_body = f"{greeting}<p>Your interview is scheduled. <a href=\"{html.escape(invite_url)}\">Open interview</a></p>"
    text = f"{greeting}\n\nOpen: {invite_url}\n"
    return {"subject": subject, "html": html_body, "text": text}


async def send_interview_invite_email(**kwargs) -> None:
    content = build_interview_invite_email(**kwargs)
    await send_mail(to=kwargs["to"], subject=content["subject"], html=content["html"], text=content["text"])
