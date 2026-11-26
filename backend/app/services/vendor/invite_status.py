"""Where each interview invite stands, for the recruiter (job page, applicant rows, Applicants panel).

States, most advanced first: completed → started → expired → booked → opened → sent.
"booked" is a scheduled slot (recruiter-picked or candidate-booked); open links (valid for days) are never booked.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from app.services.interview_invites import invite_public_url, parse_invite_context

# Same rule as the reminders: a window longer than a day is an open link, not a slot.
OPEN_LINK_MIN_WINDOW = timedelta(hours=24)
MAX_INVITES_LISTED = 500

STATE_LABELS = {
    "sent": "Invite sent",
    "opened": "Link opened",
    "booked": "Booked",
    "started": "Interview started",
    "completed": "Interview completed",
    "expired": "Invite expired",
}


def _dt(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _iso(value: Any) -> str | None:
    d = _dt(value)
    return d.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if d else None


def is_open_link(invite: dict) -> bool:
    start, end = _dt(invite.get("scheduled_start")), _dt(invite.get("scheduled_end"))
    if not start or not end:
        return True
    if parse_invite_context(invite).get("openInvite"):
        return True
    return (end - start) > OPEN_LINK_MIN_WINDOW


def invite_state(invite: dict, session_statuses: Iterable[str] = (), now: datetime | None = None) -> str:
    """One of sent / opened / booked / started / completed / expired."""
    now = now or datetime.now(timezone.utc)
    statuses = {str(s or "").lower() for s in session_statuses}
    if "completed" in statuses:
        return "completed"
    if statuses:
        return "started"
    end = _dt(invite.get("scheduled_end"))
    if end and now >= end:
        return "expired"
    if not is_open_link(invite):
        return "booked"
    if invite.get("opened_at"):
        return "opened"
    return "sent"


def reminder_info(invite: dict) -> dict | None:
    """The latest reminder for a slot: emailed, or recorded in-app because email is off."""
    sent = [(k, _dt(invite.get(col))) for k, col in (("2h", "reminder_2h_sent_at"), ("24h", "reminder_24h_sent_at"))]
    for kind, at in sent:
        if at:
            return {"kind": kind, "at": _iso(at), "channel": "email"}
    due_kind = invite.get("reminder_due_kind")
    if due_kind in ("24h", "2h"):
        return {"kind": due_kind, "at": _iso(invite.get("reminder_due_at")), "channel": "in_app"}
    return None


def serialize_invite(invite: dict, session_statuses: Iterable[str], *, now: datetime, request_origin: str | None) -> dict:
    state = invite_state(invite, session_statuses, now)
    reminder = reminder_info(invite)
    open_link = is_open_link(invite)
    return {
        "token": invite.get("token"),
        "inviteUrl": invite_public_url(str(invite.get("token") or ""), request_origin),
        "candidateEmail": str(invite.get("candidate_email") or "").strip().lower(),
        "candidateName": invite.get("candidate_name") or "",
        "jobId": invite.get("job_id"),
        "applicationId": invite.get("application_id"),
        "jobTitle": invite.get("job_title") or "",
        "openLink": open_link,
        "scheduledStart": _iso(invite.get("scheduled_start")),
        "scheduledEnd": _iso(invite.get("scheduled_end")),
        "createdAt": _iso(invite.get("created_at")),
        "emailSentAt": _iso(invite.get("email_sent_at")),
        "openedAt": _iso(invite.get("opened_at")),
        "state": state,
        "stateLabel": STATE_LABELS[state],
        "reminder": reminder,
        # A reminder is due but email is off: the recruiter should nudge the candidate themselves.
        "reminderDue": bool(reminder and reminder["channel"] == "in_app" and state == "booked"),
    }


def list_org_invites(
    pool,
    organization_id: str,
    *,
    job_id: str | None = None,
    application_id: str | None = None,
    candidate_email: str | None = None,
    limit: int = MAX_INVITES_LISTED,
) -> tuple[list[dict], dict[str, list[str]]]:
    """Invites of ONE organisation (newest first) plus the statuses of interview sessions started from each."""
    where = ["organization_id = %s"]
    args: list[Any] = [str(organization_id)]
    if job_id:
        where.append("job_id = %s")
        args.append(str(job_id))
    if application_id:
        where.append("application_id = %s")
        args.append(str(application_id))
    if candidate_email:
        where.append("lower(candidate_email) = lower(%s)")
        args.append(str(candidate_email))
    args.append(max(1, min(MAX_INVITES_LISTED, int(limit))))
    with pool.connection() as conn:
        rows = conn.execute(
            f"SELECT * FROM interview_invites WHERE {' AND '.join(where)} ORDER BY created_at DESC LIMIT %s",
            tuple(args),
        ).fetchall()
        invites = [dict(r) for r in rows]
        tokens = [str(i["token"]) for i in invites]
        statuses: dict[str, list[str]] = {}
        if tokens:
            for r in conn.execute(
                """SELECT data->>'inviteToken' AS token, data->>'status' AS status FROM interview_sessions
                   WHERE data->>'inviteToken' = ANY(%s)""",
                (tokens,),
            ).fetchall():
                row = dict(r)
                statuses.setdefault(str(row["token"]), []).append(str(row.get("status") or "in_progress"))
    return invites, statuses


# An unfinished session idle for longer than this was abandoned, not "in progress".
ACTIVE_SESSION_IDLE = timedelta(hours=2)


def list_active_interviews(pool, organization_id: str, *, now: datetime | None = None) -> list[dict]:
    """Interviews of this organisation running right now (started, not completed, touched recently)."""
    now = now or datetime.now(timezone.utc)
    with pool.connection() as conn:
        rows = conn.execute(
            """SELECT data->>'applicationId' AS application_id, lower(email) AS email, data->>'jobId' AS job_id,
                      data->>'startedAt' AS started_at
                 FROM interview_sessions
                WHERE COALESCE(organization_id, data->>'organizationId') = %s
                  AND COALESCE(data->>'status', '') <> 'completed'
                  AND updated_at >= %s
                ORDER BY updated_at DESC LIMIT 200""",
            (str(organization_id), now - ACTIVE_SESSION_IDLE),
        ).fetchall()
    return [
        {
            "applicationId": dict(r).get("application_id"),
            "candidateEmail": dict(r).get("email"),
            "jobId": dict(r).get("job_id"),
            "startedAt": dict(r).get("started_at"),
        }
        for r in rows
    ]


def mark_invite_opened(pool, token: str) -> None:
    """First time the candidate loads the invite page (later loads keep the first time)."""
    with pool.connection() as conn:
        conn.execute(
            "UPDATE interview_invites SET opened_at = NOW() WHERE token = %s AND opened_at IS NULL", (str(token)[:128],)
        )
        conn.commit()
