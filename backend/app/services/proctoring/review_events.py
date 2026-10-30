from __future__ import annotations

from datetime import datetime, timezone

TYPES = frozenset({"NO_FACE_SEEN", "MULTIPLE_FACES_DETECTED", "SIDE_GAZE_LOOKING_AWAY", "UNABLE_TO_ASSESS"})


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
            "severity": "warn",
            "reviewOnly": True,
            "candidateExplanation": (prev or {}).get("candidateExplanation") or "",
        }
    if len(events) > 1000:
        raise ValueError("Review event limit reached.")
    return sorted(events.values(), key=lambda x: x["startOffsetSec"])
