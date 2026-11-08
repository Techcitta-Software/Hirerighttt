"""Interview integrity rules shared by interview start and scoring.

- A finished interview is never re-scored (a candidate could otherwise resubmit better answers).
- Answers recorded by the server turn by turn win over answers the browser sends at the end.
- An interview invite allows one completed attempt.
- A session must be scored within a few hours of starting.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

MAX_SESSION_AGE_HOURS = 6


def _question_text(q: Any) -> str:
    if isinstance(q, dict):
        return str(q.get("text") or "").strip()
    return str(q or "").strip()


def authoritative_answers(session: dict, client_answers: list, questions: list) -> list[str]:
    """Answers to score, one per question.

    For every question the server already recorded an answer for (via /api/interview/next), that answer is used.
    The browser's answer is only used for questions the server has no answer for yet, i.e. the final turn.
    """
    recorded: dict[str, str] = {}
    for turn in session.get("history") or []:
        text = _question_text(turn.get("question"))
        if text:
            recorded[text] = str(turn.get("answer") or "")
    client = [str(a) for a in client_answers or []]
    out: list[str] = []
    for i, q in enumerate(questions):
        text = _question_text(q)
        if text in recorded:
            out.append(recorded[text])
        elif i < len(client):
            out.append(client[i])
        else:
            break
    return out


def session_is_stale(session: dict, now: datetime | None = None) -> bool:
    started_raw = session.get("startedAt")
    if not started_raw:
        return False
    try:
        started = datetime.fromisoformat(str(started_raw).replace("Z", "+00:00"))
    except ValueError:
        return False
    now = now or datetime.now(timezone.utc)
    return (now - started).total_seconds() > MAX_SESSION_AGE_HOURS * 3600


def invite_attempt_used(db: dict, invite_token: str) -> bool:
    """True when an interview started from this invite has already been completed."""
    if not invite_token:
        return False
    return any(
        s.get("inviteToken") == invite_token and s.get("status") == "completed"
        for s in (db.get("interviewSessions") or {}).values()
        if isinstance(s, dict)
    )
