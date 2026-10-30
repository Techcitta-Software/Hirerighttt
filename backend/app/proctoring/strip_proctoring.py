from __future__ import annotations

from typing import Any


def strip_interview_result_for_candidate(interview: dict[str, Any] | None) -> dict[str, Any] | None:
    if not interview or not isinstance(interview, dict):
        return interview
    integrity = interview.get("integrity")
    if not isinstance(integrity, dict):
        return interview
    rest = {k: v for k, v in integrity.items() if k not in {"proctoring", "flaggedSections", "logs"}}
    next_iv = dict(interview)
    if rest:
        next_iv["integrity"] = rest
    else:
        next_iv.pop("integrity", None)
    return next_iv
