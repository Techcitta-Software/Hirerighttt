"""Interview integrity rules shared by interview start and scoring.

- A finished interview is never re-scored (a candidate could otherwise resubmit better answers).
- Answers recorded by the server turn by turn win over answers the browser sends at the end.
- An interview invite allows one completed attempt.
- A session must be scored within a few hours of starting.
"""

from __future__ import annotations

from app.db.finders import sessions_for_invite
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
        for s in sessions_for_invite(db, invite_token)
        if isinstance(s, dict)
    )


_COUNTERS = ("faceViolations", "sideLookWarnings", "tooFarWarnings")


def merge_server_integrity(session: dict, client: dict | None) -> dict:
    """Integrity data for scoring (V-14). Proctoring runs in the browser, so the client report is used, but it can
    only ADD to what the server already recorded: counters take the maximum, a ban or a multi-person sighting the
    server saw cannot be cleared, and camera flags the server persisted (/api/interview/review-events) are always
    included. A client that sends an empty report no longer strips the flags."""
    from app.services.proctoring.persist_flags import review_logs_to_flag_sections

    client = dict(client or {})
    server = session.get("integrity") if isinstance(session.get("integrity"), dict) else {}
    merged = {**client}
    for key in _COUNTERS:
        try:
            merged[key] = max(int(client.get(key) or 0), int(server.get(key) or 0))
        except (TypeError, ValueError):
            merged[key] = int(server.get(key) or 0)
    try:
        merged["maxFacesSeen"] = max(int(client.get("maxFacesSeen") or 1), int(server.get("maxFacesSeen") or 1))
    except (TypeError, ValueError):
        merged["maxFacesSeen"] = int(server.get("maxFacesSeen") or 1)
    merged["singlePersonOk"] = client.get("singlePersonOk") is not False and server.get("singlePersonOk") is not False
    merged["banned"] = bool(client.get("banned")) or bool(server.get("banned"))
    if server.get("banned") and server.get("banReason"):
        merged["banReason"] = server.get("banReason")

    server_events = session.get("reviewEvents")
    server_logs = [e for e in (server_events if isinstance(server_events, list) else []) if isinstance(e, dict)]
    raw_logs = client.get("logs")
    client_logs = [e for e in (raw_logs if isinstance(raw_logs, list) else []) if isinstance(e, dict)][:1000]
    by_id: dict = {}
    for e in client_logs + server_logs:  # server copy wins for the same event id
        by_id[e.get("id") or id(e)] = e
    merged["logs"] = list(by_id.values())

    raw_sections = client.get("flaggedSections")
    client_sections = [f for f in (raw_sections if isinstance(raw_sections, list) else []) if isinstance(f, dict)][:1000]
    server_sections = review_logs_to_flag_sections(server_logs)
    merged["flaggedSections"] = client_sections if len(client_sections) >= len(server_sections) else server_sections
    if not merged["flaggedSections"] and client_logs:
        merged["flaggedSections"] = review_logs_to_flag_sections(merged["logs"])
    return merged
