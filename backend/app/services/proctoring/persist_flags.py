from __future__ import annotations

from typing import Any


async def persist_proctoring_flags(*, tenant_id: str, session_id: str, flagged_sections: list) -> dict[str, Any]:
    counts = {"total": len(flagged_sections), "lookingSide": 0, "multiplePeople": 0, "noFace": 0}
    for f in flagged_sections:
        t = str(f.get("type") or f.get("eventType") or "")
        if "SIDE" in t:
            counts["lookingSide"] += 1
        elif "MULTIPLE" in t:
            counts["multiplePeople"] += 1
        elif "NO_FACE" in t:
            counts["noFace"] += 1
    return {
        "integrityScore": max(0, 100 - counts["total"] * 5),
        "status": "CLEAR" if counts["total"] == 0 else "REVIEW",
        "counts": counts,
        "flaggedSections": flagged_sections,
    }


def review_logs_to_flag_sections(logs: list | None) -> list:
    out = []
    for e in logs or []:
        if not isinstance(e, dict):
            continue
        out.append(
            {
                "type": e.get("eventType"),
                "startOffsetSec": e.get("startOffsetSec"),
                "durationSec": e.get("durationSec"),
                "peakMetrics": {"faceCount": 2 if e.get("eventType") == "MULTIPLE_FACES_DETECTED" else 1},
            }
        )
    return out
