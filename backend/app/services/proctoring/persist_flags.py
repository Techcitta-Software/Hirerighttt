from __future__ import annotations

from typing import Any

from app.services.proctoring.review_events import FACE_TYPES


def _sanitize_proctor_flag(flag: dict) -> dict:
    return {k: v for k, v in flag.items() if k not in ("snapshotDataUrl", "snapshotS3Key")}


async def persist_proctoring_flags(*, tenant_id: str, session_id: str, flagged_sections: list) -> dict[str, Any]:
    sanitized = [_sanitize_proctor_flag(f) for f in flagged_sections if isinstance(f, dict)]
    counts = {"total": len(sanitized), "lookingSide": 0, "multiplePeople": 0, "noFace": 0}
    for f in sanitized:
        t = str(f.get("type") or f.get("eventType") or "")
        if "SIDE" in t or t == "LOOKING_SIDE":
            counts["lookingSide"] += 1
        elif "MULTIPLE" in t or t == "MULTI_FACE":
            counts["multiplePeople"] += 1
        elif "NO_FACE" in t:
            counts["noFace"] += 1
    return {
        "integrityScore": max(0, 100 - counts["total"] * 5),
        "status": "CLEAR" if counts["total"] == 0 else "REVIEW",
        "counts": counts,
        "flaggedSections": sanitized,
    }


def review_logs_to_flag_sections(logs: list | None) -> list:
    # Only camera events become "flagged sections" (and score deductions). Lockdown / copy-paste / dev-tools
    # events stay in the review log for the recruiter but never change the score by themselves.
    out = []
    for e in logs or []:
        if not isinstance(e, dict) or e.get("eventType") not in FACE_TYPES:
            continue
        out.append(
            {
                "id": e.get("id"),
                "type": e.get("eventType"),
                "startOffsetSec": e.get("startOffsetSec"),
                "durationSec": e.get("durationSec"),
                "peakMetrics": {"faceCount": 2 if e.get("eventType") == "MULTIPLE_FACES_DETECTED" else 1},
            }
        )
    return out
