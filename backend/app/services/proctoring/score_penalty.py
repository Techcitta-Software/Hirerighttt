from __future__ import annotations

from typing import Any

FACE_DEVIATION_SCORE_PENALTY = 5

_DEVIATION_LOG_TYPES = frozenset(
    {"SIDE_GAZE_LOOKING_AWAY", "NO_FACE_SEEN", "MULTIPLE_FACES_DETECTED"},
)
_DEVIATION_FLAG_TYPES = frozenset({"LOOKING_SIDE", "NO_FACE", "MULTI_FACE"})


def count_face_proctor_deviations(integrity: dict | None, proctoring: dict | None = None) -> int:
    integrity = integrity or {}
    sections = integrity.get("flaggedSections") if isinstance(integrity.get("flaggedSections"), list) else []
    from_flags = sum(1 for f in sections if isinstance(f, dict) and str(f.get("type") or "") in _DEVIATION_FLAG_TYPES)
    if from_flags:
        return from_flags
    logs = integrity.get("logs") if isinstance(integrity.get("logs"), list) else []
    from_logs = sum(
        1 for e in logs if isinstance(e, dict) and str(e.get("eventType") or "") in _DEVIATION_LOG_TYPES
    )
    if from_logs:
        return from_logs
    if proctoring and isinstance(proctoring.get("counts"), dict):
        total = int(proctoring["counts"].get("total") or 0)
        if total > 0:
            return total
    return 0


def _restate_score_in_scorecard(scorecard: dict[str, Any], before: int, after: int) -> None:
    """Everything derived from the overall score must show the penalised score, not the one before it.

    The report used to say "Kavya scored 70/100" next to an overall of 65. The career score is the interview
    score itself, so it is penalised by exactly the same points.
    """
    if before == after:
        return
    from app.services.interview_agent import career_score_for

    old_text, new_text = f"{before}/100", f"{after}/100"
    for key in ("bandInterpretation", "coachNotes"):
        if isinstance(scorecard.get(key), str):
            scorecard[key] = scorecard[key].replace(old_text, new_text)
    if isinstance(scorecard.get("careerScore"), (int, float)):
        scorecard["careerScore"] = career_score_for(after)
    for axis in scorecard.get("radarAxes") or []:
        if isinstance(axis, dict) and axis.get("label") == "Overall":
            axis["val"] = after


def apply_face_deviation_penalty_to_result(result: dict[str, Any], deviations: int) -> dict[str, Any]:
    if not deviations or not isinstance(result, dict):
        return result
    penalty = deviations * FACE_DEVIATION_SCORE_PENALTY
    before = result.get("overall")
    for key in ("overall", "interviewScore", "compositeScore"):
        if isinstance(result.get(key), (int, float)):
            result[key] = max(0, int(result[key]) - penalty)
    scorecard = result.get("scorecard")
    if isinstance(scorecard, dict):
        if isinstance(scorecard.get("overallInterviewScore"), (int, float)):
            scorecard["overallInterviewScore"] = max(0, int(scorecard["overallInterviewScore"]) - penalty)
        stats = scorecard.get("sessionStats")
        if isinstance(stats, dict) and isinstance(stats.get("overallInterviewScore"), (int, float)):
            stats["overallInterviewScore"] = max(0, int(stats["overallInterviewScore"]) - penalty)
        if isinstance(before, (int, float)) and isinstance(result.get("overall"), (int, float)):
            _restate_score_in_scorecard(scorecard, int(before), int(result["overall"]))
    result["proctorDeviationCount"] = deviations
    result["proctorScorePenalty"] = penalty
    if isinstance(before, (int, float)):
        # Shown on the report so the deduction is transparent: score before, points taken off, final score.
        result["scoreBeforeProctorPenalty"] = int(before)
    improvements = result.get("improvements")
    note = f"{deviations} camera proctoring deviation(s) (−{penalty} points on overall score)."
    if isinstance(improvements, list) and not any("camera proctoring" in str(s) for s in improvements):
        improvements.append(f"Stay centered on camera during the interview. {note}")
    return result
