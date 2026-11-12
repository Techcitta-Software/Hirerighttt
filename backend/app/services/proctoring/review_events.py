from __future__ import annotations

from datetime import datetime, timezone

# Camera-based review events.
FACE_TYPES = frozenset({"NO_FACE_SEEN", "MULTIPLE_FACES_DETECTED", "SIDE_GAZE_LOOKING_AWAY", "UNABLE_TO_ASSESS"})
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
TYPES = FACE_TYPES | LOCKDOWN_TYPES
SEVERITIES = frozenset({"warn", "block", "ban"})
MAX_EVENTS_PER_BATCH = 1000


def merge_review_events(existing: list | None, incoming: list) -> list:
    if not isinstance(incoming, list) or len(incoming) > 1000:
        raise ValueError("Invalid review event batch.")
    events = {e["id"]: e for e in (existing or []) if isinstance(e, dict) and e.get("id")}
    for e in incoming:
        if (
            not e
            or not isinstance(e.get("id"), str)
            or len(e["id"]) > 100
            or e.get("eventType") not in TYPES
            or not isinstance(e.get("startOffsetSec"), (int, float))
            or not isinstance(e.get("durationSec"), (int, float))
        ):
            raise ValueError("Invalid review event.")
        prev = events.get(e["id"])
        if prev and (prev.get("eventType") != e.get("eventType") or prev.get("startOffsetSec") != e.get("startOffsetSec")):
            raise ValueError("Event identity cannot change.")
        events[e["id"]] = {
            "id": e["id"],
            "eventType": e["eventType"],
            "startOffsetSec": e["startOffsetSec"],
            "durationSec": max(prev.get("durationSec", 0) if prev else 0, e["durationSec"]),
            "timestamp": datetime.fromisoformat(str(e["timestamp"]).replace("Z", "+00:00")).isoformat(),
            "formattedTime": str(e.get("formattedTime") or "")[:30],
            "message": str(e.get("message") or "")[:500],
            # Lockdown events keep their severity; camera events stay review-only warnings.
            "severity": e.get("severity") if e["eventType"] in LOCKDOWN_TYPES and e.get("severity") in SEVERITIES else "warn",
            "reviewOnly": False if e["eventType"] in LOCKDOWN_TYPES and e.get("reviewOnly") is False else True,
            "candidateExplanation": (prev or {}).get("candidateExplanation") or "",
        }
    if len(events) > 1000:
        raise ValueError("Review event limit reached.")
    return sorted(events.values(), key=lambda x: x["startOffsetSec"])
