from __future__ import annotations

import html
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

from app.services.mail_service import send_mail, smtp_configured

# How long after the slot starts the candidate can still join. 15 minutes leaves room for signing in and a
# camera check (5 minutes made late-by-a-little candidates miss their interview).
configured_join = int(os.environ.get("INVITE_JOIN_WINDOW_MINUTES") or 15)
INVITE_JOIN_WINDOW_MINUTES = min(30, max(1, configured_join if configured_join == configured_join else 15))


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


IST = timezone(timedelta(hours=5, minutes=30))
DEFAULT_OPEN_INVITE_DAYS = 7


def _fmt_ist(value: datetime) -> str:
    return value.astimezone(IST).strftime("%a, %d %b %Y, %I:%M %p IST")


def build_interview_invite_email(**kwargs) -> dict[str, str]:
    """Branded invite email. `openInvite=True` means the link works any time until `scheduledEnd`."""
    start = datetime.fromisoformat(str(kwargs["scheduledStart"]).replace("Z", "+00:00"))
    end_raw = kwargs.get("scheduledEnd")
    end = datetime.fromisoformat(str(end_raw).replace("Z", "+00:00")) if end_raw else invite_join_window_end(start)
    invite_url = str(kwargs["inviteUrl"])
    job_title = str(kwargs.get("jobTitle") or "").strip()
    company = str(kwargs.get("company") or "").strip()
    candidate_name = str(kwargs.get("candidateName") or "").strip()
    duration = int(kwargs.get("durationMinutes") or 20)
    open_invite = bool(kwargs.get("openInvite"))

    esc = html.escape
    first = candidate_name.split()[0] if candidate_name else ""
    greeting = f"Hi {esc(first)}," if first else "Hello,"
    role_line = f"the <b>{esc(job_title)}</b> role" if job_title else "your interview"
    from_line = f" at <b>{esc(company)}</b>" if company else ""
    subject_role = f" for {job_title}" if job_title else ""
    if open_invite:
        subject = f"You're invited to an AI interview{subject_role}"
        when_html = (
            f"Start whenever you are ready &mdash; this link stays active until <b>{esc(_fmt_ist(end))}</b>."
        )
        when_text = f"Start whenever you are ready. This link is active until {_fmt_ist(end)}."
    else:
        subject = f"Booking confirmed: AI interview{subject_role}"
        when_html = (
            f"Your interview opens on <b>{esc(_fmt_ist(start))}</b>. "
            f"Open the link at that time and join within {max(1, round((end - start).total_seconds() / 60))} minutes."
        )
        when_text = f"Your interview opens on {_fmt_ist(start)}."

    html_body = f"""<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f3ff;font-family:Arial,Helvetica,sans-serif;color:#141638;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f3ff;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e5ef;">
<tr><td style="background:#251e6d;padding:22px 28px;color:#ffffff;font-size:22px;font-weight:700;">HireRighttt</td></tr>
<tr><td style="padding:28px;">
<p style="margin:0 0 14px;font-size:16px;">{greeting}</p>
<p style="margin:0 0 14px;font-size:16px;line-height:1.55;">You have been invited to complete a short AI interview for {role_line}{from_line}. The questions are based on your own resume, so there is nothing to prepare beyond being yourself.</p>
<p style="margin:0 0 22px;font-size:16px;line-height:1.55;">{when_html}</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 22px;"><tr><td style="background:#5046e5;border-radius:999px;">
<a href="{esc(invite_url)}" style="display:inline-block;padding:14px 30px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;">Start your interview</a>
</td></tr></table>
<p style="margin:0 0 8px;font-size:14px;color:#5f6686;">If the button does not work, copy this link into your browser:</p>
<p style="margin:0 0 22px;font-size:13px;word-break:break-all;"><a href="{esc(invite_url)}" style="color:#5046e5;">{esc(invite_url)}</a></p>
<div style="background:#faf9ff;border:1px solid #ece9ff;border-radius:12px;padding:16px 18px;font-size:14px;line-height:1.6;">
<b>Before you start</b><br>
&bull; It takes about {duration} minutes and uses your camera and microphone.<br>
&bull; Use Chrome or Edge on a laptop or desktop, in a quiet, well-lit room, on a stable connection.<br>
&bull; Sign in or create an account with <b>this email address</b> so the invite matches you.<br>
&bull; Answer in your own words. Only one person should be on camera.
</div>
<p style="margin:22px 0 0;font-size:13px;color:#8a8fa8;">This link was created for you and should not be shared. If you were not expecting this email, you can ignore it.</p>
</td></tr></table>
</td></tr></table>
</body></html>"""
    text = (
        f"{('Hi ' + first + ',') if first else 'Hello,'}\n\n"
        f"You have been invited to an AI interview{subject_role}"
        f"{(' at ' + company) if company else ''}. The questions are based on your own resume.\n\n"
        f"{when_text}\n\nStart your interview: {invite_url}\n\n"
        f"It takes about {duration} minutes and needs your camera and microphone. "
        "Sign in or create an account with this email address.\n\n"
        "If you were not expecting this email, you can ignore it.\n"
    )
    return {"subject": subject, "html": html_body, "text": text}


async def send_interview_invite_email(**kwargs) -> None:
    content = build_interview_invite_email(**kwargs)
    await send_mail(to=kwargs["to"], subject=content["subject"], html=content["html"], text=content["text"])
