from __future__ import annotations

import math
from datetime import datetime, timezone

# Camera-based review events.
FACE_TYPES = frozenset({"NO_FACE_SEEN", "MULTIPLE_FACES_DETECTED", "SIDE_GAZE_LOOKING_AWAY", "UNABLE_TO_ASSESS"})
# Camera behaviour signals that are shown on the recording timeline for the reviewer only. They are deliberately NOT in
# FACE_TYPES (and not in the score-penalty sets), so adding them never changes how an interview is scored.
BEHAVIOUR_TYPES = frozenset({"EXCESSIVE_MOVEMENT", "PHONE_DETECTED"})
# Interview-room lockdown and copy-protection events. The browser always sends the full event list, so the server
# must accept these too, otherwise one lockdown event makes every camera event fail to sync.
LOCKDOWN_TYPES = frozenset(
    {
        "TAB_OR_WINDOW_LEFT",
        "FULLSCREEN_EXITED",
        "INTERVIEW_BANNED",
        "COPY_PASTE_ATTEMPT",
        "BLOCKED_SHORTCUT",
        "DEVTOOLS_SUSPECTED",
        "MULTIPLE_MONITORS",
        "SCREENSHOT_ATTEMPT",
        "VIRTUAL_CAMERA_SUSPECTED",
    }
)
TYPES = FACE_TYPES | BEHAVIOUR_TYPES | LOCKDOWN_TYPES
SEVERITIES = frozenset({"warn", "block", "ban"})
MAX_EVENTS_PER_BATCH = 1000
# Events stored per interview session. Past the cap new events are dropped (existing ones still get their durations
# updated), so a noisy client can neither grow the session row without bound nor make every later sync fail.
MAX_EVENTS_PER_SESSION = 1000
# Offsets are seconds from the start of the interview recording; nothing real is longer than this.
MAX_OFFSET_SEC = 6 * 60 * 60


def _finite_number(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def _parse_timestamp(value) -> str:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError) as err:
        raise ValueError("Invalid review event.") from err
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.isoformat()


def _with_ms_offsets(event: dict) -> dict:
    """Integer millisecond offsets from the start of the recording, for the review timeline under the video."""
    start = float(event.get("startOffsetSec") or 0)
    duration = float(event.get("durationSec") or 0)
    event["startOffsetMs"] = int(round(start * 1000))
    event["endOffsetMs"] = int(round((start + duration) * 1000))
    return event


def merge_review_events(existing: list | None, incoming: list) -> list:
    if not isinstance(incoming, list) or len(incoming) > MAX_EVENTS_PER_BATCH:
        raise ValueError("Invalid review event batch.")
    events = {e["id"]: e for e in (existing or []) if isinstance(e, dict) and e.get("id")}
    for e in incoming:
        if not isinstance(e, dict):
            raise ValueError("Invalid review event.")
        start = _finite_number(e.get("startOffsetSec"))
        duration = _finite_number(e.get("durationSec"))
        if (
            not isinstance(e.get("id"), str)
            or not e["id"]
            or len(e["id"]) > 100
            or e.get("eventType") not in TYPES
            or start is None
            or duration is None
            or start < 0
            or start > MAX_OFFSET_SEC
            or duration < 0
        ):
            raise ValueError("Invalid review event.")
        duration = min(duration, MAX_OFFSET_SEC - start)
        prev = events.get(e["id"])
        if prev and (prev.get("eventType") != e.get("eventType") or prev.get("startOffsetSec") != start):
            raise ValueError("Event identity cannot change.")
        if not prev and len(events) >= MAX_EVENTS_PER_SESSION:
            continue
        events[e["id"]] = _with_ms_offsets(
            {
                "id": e["id"],
                "eventType": e["eventType"],
                "startOffsetSec": start,
                "durationSec": max(float(prev.get("durationSec", 0) or 0) if prev else 0.0, duration),
                "timestamp": _parse_timestamp(e.get("timestamp")),
                "formattedTime": str(e.get("formattedTime") or "")[:30],
                "message": str(e.get("message") or "")[:500],
                # Lockdown events keep their severity; camera events stay review-only warnings.
                "severity": e.get("severity") if e["eventType"] in LOCKDOWN_TYPES and e.get("severity") in SEVERITIES else "warn",
                "reviewOnly": False if e["eventType"] in LOCKDOWN_TYPES and e.get("reviewOnly") is False else True,
                "candidateExplanation": (prev or {}).get("candidateExplanation") or "",
                **({"explainedAt": prev["explainedAt"]} if prev and prev.get("explainedAt") else {}),
            }
        )
    return sorted(events.values(), key=lambda x: x["startOffsetSec"])


def timeline_events(events: list | None) -> list:
    """Stored review events as served to reviewers: valid entries only, each with millisecond offsets.

    Sessions saved before the offsets were stored get them computed here, so old recordings still line up.
    """
    out = []
    for e in events or []:
        if not isinstance(e, dict) or e.get("eventType") not in TYPES:
            continue
        start = _finite_number(e.get("startOffsetSec"))
        if start is None or start < 0:
            continue
        duration = _finite_number(e.get("durationSec"))
        out.append(_with_ms_offsets({**e, "startOffsetSec": start, "durationSec": max(0.0, duration or 0.0)}))
    return sorted(out, key=lambda x: x["startOffsetSec"])[:MAX_EVENTS_PER_SESSION]
