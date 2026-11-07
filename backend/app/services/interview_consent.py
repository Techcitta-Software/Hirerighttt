"""Candidate consent for interview recording, face tracking and AI scoring.

The waiting room sends a consent object; the server refuses to start an interview without it and stores
its own timestamp, the consent wording version and the requester IP on the interview session.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

REQUIRED_FLAGS = ("recording", "faceTracking", "aiScoring")


def parse_interview_consent(raw: Any, ip: str | None) -> dict[str, Any] | None:
    """Return a consent record to store, or None when consent is missing or incomplete."""
    if not isinstance(raw, dict):
        return None
    if not all(raw.get(flag) is True for flag in REQUIRED_FLAGS):
        return None
    version = str(raw.get("version") or "").strip()[:40]
    if not version:
        return None
    return {
        "version": version,
        "recording": True,
        "faceTracking": True,
        "aiScoring": True,
        "clientAcceptedAt": str(raw.get("acceptedAt") or "")[:40] or None,
        "recordedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "ip": ip,
    }
