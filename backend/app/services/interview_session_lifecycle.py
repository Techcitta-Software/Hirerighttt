"""Interview session lifecycle: pending (prepared in the waiting room) -> active (candidate entered) -> completed.

T5 B11/B12/B9:
- Opening the waiting room prepares questions, but that must not claim the free career interview or create a new
  billable session on every page load. A prepared session is `pending`; it is reused for the same candidate and
  interview context, and expires unused after PENDING_TTL_MINUTES.
- The free interview (or a paid credit) is claimed only when the candidate enters the room (POST
  /api/interview/enter) or records the first answer.
- A reload / crash mid-interview resumes the SAME `active` session (same questions, recorded answers kept). An active
  session older than MAX_SESSION_AGE_HOURS can no longer be scored: it is marked `abandoned` and the candidate is told.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any

from app.services.interview_integrity import MAX_SESSION_AGE_HOURS, session_is_stale

PENDING_TTL_MINUTES = 30
STATUS_PENDING = "pending"
STATUS_ACTIVE = "active"
STATUS_EXPIRED = "expired"
STATUS_ABANDONED = "abandoned"


def now_iso(now: datetime | None = None) -> str:
    return (now or datetime.now(timezone.utc)).isoformat().replace("+00:00", "Z")


def _parse(ts: Any) -> datetime | None:
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def interview_context_key(
    *,
    email: str,
    invite_token: str | None,
    application_id: str | None,
    job_id: str | None,
    role: str,
    level: str,
    job_description: str,
) -> str:
    """One prepared/resumable session per candidate + interview context.

    A job interview is identified by its invite / application / job; a career interview by role, level and JD."""
    # The application wins over the invite token: an invite opened in a new tab (token lost) still resumes the same
    # job interview through the application the invite is linked to.
    if application_id:
        ident = f"app:{application_id}"
    elif job_id:
        ident = f"job:{job_id}"
    elif invite_token:
        ident = f"invite:{invite_token}"
    else:
        jd_hash = hashlib.sha256(str(job_description or "").strip().encode("utf-8", "replace")).hexdigest()[:16]
        ident = f"career:{str(role or '').strip().lower()}|{str(level or '').strip().lower()}|{jd_hash}"
    return hashlib.sha256(f"{str(email or '').strip().lower()}|{ident}".encode()).hexdigest()[:32]


def pending_expired(session: dict, now: datetime | None = None) -> bool:
    created = _parse(session.get("createdAt"))
    if not created:
        return False
    now = now or datetime.now(timezone.utc)
    return (now - created).total_seconds() > PENDING_TTL_MINUTES * 60


def sweep_candidate_sessions(items: list[tuple[str, dict]], now: datetime | None = None) -> list[dict]:
    """Expire unused prepared sessions and abandon active ones that can no longer be scored.

    Mutates the sessions in place; returns the sessions that were just marked abandoned."""
    now = now or datetime.now(timezone.utc)
    abandoned: list[dict] = []
    for _sid, s in items:
        if not isinstance(s, dict):
            continue
        status = s.get("status")
        if status == STATUS_PENDING and pending_expired(s, now):
            s["status"] = STATUS_EXPIRED
            s["expiredAt"] = now_iso(now)
        elif status == STATUS_ACTIVE and session_is_stale(s, now):
            s["status"] = STATUS_ABANDONED
            s["abandonedAt"] = now_iso(now)
            abandoned.append(s)
    return abandoned


def find_reusable_session(items: list[tuple[str, dict]], context_key: str) -> tuple[str, dict] | None:
    """The candidate's open session for this context: an active one (resume) wins over a prepared one."""
    best: tuple[str, dict] | None = None
    for sid, s in items:
        if not isinstance(s, dict) or s.get("contextKey") != context_key:
            continue
        status = s.get("status")
        if status == STATUS_ACTIVE:
            return sid, s
        if status == STATUS_PENDING and best is None:
            best = (sid, s)
    return best


def last_abandoned(items: list[tuple[str, dict]], context_key: str) -> dict | None:
    for _sid, s in reversed(items):
        if isinstance(s, dict) and s.get("contextKey") == context_key and s.get("status") == STATUS_ABANDONED:
            return s
    return None


def previous_attempt_notice(session: dict | None) -> dict | None:
    if not session:
        return None
    answered = len([t for t in session.get("history") or [] if isinstance(t, dict) and str(t.get("answer") or "").strip()])
    return {
        "status": STATUS_ABANDONED,
        "answered": answered,
        "startedAt": session.get("startedAt"),
        "message": (
            f"Your previous interview was left unfinished for more than {MAX_SESSION_AGE_HOURS} hours, so it has "
            "ended and cannot be scored. This is a new interview."
        ),
    }


def mark_entered(session: dict, now: datetime | None = None) -> None:
    stamp = now_iso(now)
    session["status"] = STATUS_ACTIVE
    session["enteredAt"] = stamp
    # Interview time (duration, the 6-hour scoring window) counts from entering the room, not from the lobby.
    session["startedAt"] = stamp
    session["lastActivityAt"] = stamp


def _q_text(q: Any) -> str:
    if isinstance(q, dict):
        return str(q.get("text") or "").strip()
    return str(q or "").strip()


def record_answer(session: dict, index: int, question: Any, answer: str, now: datetime | None = None) -> list:
    """Store one answer as the candidate gives it, so a reload keeps it. The server's own question wins."""
    questions = session.get("questions") or []
    server_q = questions[index] if 0 <= index < len(questions) else None
    q = server_q if _q_text(server_q) else (question if isinstance(question, dict) else {"text": _q_text(question)})
    turn = {"question": q, "answer": str(answer or "")[:20000]}
    history = [t for t in session.get("history") or [] if isinstance(t, dict)]
    if index < len(history):
        history = history[:index] + [turn]
    else:
        history.append(turn)
    session["history"] = history
    session["lastActivityAt"] = now_iso(now)
    return history


def resume_state(session: dict) -> dict:
    """Where a returning candidate continues: the first unanswered question, with the recorded answers."""
    history = [t for t in session.get("history") or [] if isinstance(t, dict)]
    questions = session.get("questions") or []
    total = int(session.get("totalTurns") or len(questions) or 1)
    answered = len(history)
    index = min(answered, max(0, min(total, len(questions)) - 1)) if questions else 0
    return {
        "questionIndex": index,
        "answeredCount": answered,
        "history": [{"question": t.get("question"), "answer": str(t.get("answer") or "")} for t in history],
        "answers": [str(t.get("answer") or "") for t in history],
    }


def question_needs_generation(session: dict, index: int) -> bool:
    questions = session.get("questions") or []
    if index >= len(questions):
        return True
    return len(_q_text(questions[index])) < 24


SWEEP_SQL_ABANDON = """
UPDATE interview_sessions
   SET data = data || jsonb_build_object('status', 'abandoned', 'abandonedAt', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
       updated_at = NOW()
 WHERE data->>'status' = 'active'
   AND updated_at < NOW() - make_interval(hours => %s)
"""
SWEEP_SQL_DROP_PENDING = """
DELETE FROM interview_sessions
 WHERE data->>'status' IN ('pending', 'expired')
   AND updated_at < NOW() - INTERVAL '1 day'
"""


def sweep_sessions_sql(conn) -> dict[str, int]:
    """Maintenance: close interviews nobody touched for MAX_SESSION_AGE_HOURS, drop prepared sessions never entered."""
    abandoned = conn.execute(SWEEP_SQL_ABANDON, (MAX_SESSION_AGE_HOURS,)).rowcount or 0
    dropped = conn.execute(SWEEP_SQL_DROP_PENDING).rowcount or 0
    return {"interviews_abandoned": abandoned, "interviews_unused_dropped": dropped}
