"""Camera proctoring deduction: 5 points per sustained deviation, capped, and no "no face" cost when the
candidate chose "Continue without camera"."""

from __future__ import annotations

from app.services.proctoring.score_penalty import (
    FACE_DEVIATION_SCORE_PENALTY,
    MAX_PROCTOR_SCORE_PENALTY,
    apply_face_deviation_penalty_to_result,
    count_face_proctor_deviations,
)


def _result(overall: int = 53) -> dict:
    return {"overall": overall, "interviewScore": overall, "improvements": [], "scorecard": {"overallInterviewScore": overall}}


def test_penalty_is_capped_so_noisy_camera_cannot_zero_the_score():
    out = apply_face_deviation_penalty_to_result(_result(53), 18)
    assert MAX_PROCTOR_SCORE_PENALTY == 20
    assert out["proctorScorePenalty"] == 20
    assert out["overall"] == 33 and out["interviewScore"] == 33
    assert out["scorecard"]["overallInterviewScore"] == 33
    assert out["scoreBeforeProctorPenalty"] == 53
    assert out["proctorDeviationCount"] == 18


def test_small_penalty_is_still_five_per_event():
    out = apply_face_deviation_penalty_to_result(_result(60), 1)
    assert out["proctorScorePenalty"] == FACE_DEVIATION_SCORE_PENALTY
    assert out["overall"] == 55


def test_camera_off_by_choice_skips_no_face_but_keeps_other_flags():
    sections = [
        {"type": "NO_FACE", "startSec": 0, "endSec": 180, "durationSec": 180},
        {"type": "MULTI_FACE", "startSec": 40, "endSec": 42, "durationSec": 2},
    ]
    assert count_face_proctor_deviations({"flaggedSections": sections}) == 2
    assert count_face_proctor_deviations({"flaggedSections": sections, "cameraOffByChoice": True}) == 1
    only_no_face = {"flaggedSections": sections[:1], "logs": [{"eventType": "NO_FACE_SEEN", "durationSec": 9}], "cameraOffByChoice": True}
    # Nothing but "no face": no deduction, and the summary totals are not used as a fallback.
    assert count_face_proctor_deviations(only_no_face, {"counts": {"total": 1}}) == 0


def test_score_session_reports_camera_off_by_choice_for_the_recruiter():
    from app.services.interview_agent import score_session

    out = score_session(
        role="Backend Developer", level="Fresher",
        questions=[{"focus": "structured-theory-2", "category": "Technical", "text": "Explain REST APIs.", "topic": "Technical"}],
        answers=["REST APIs use HTTP verbs on resources; I built one with FastAPI and PostgreSQL for a project."],
        profile={"skills": ["Python"]}, integrity={"cameraOffByChoice": True}, name="T",
    )
    assert out["integrity"]["cameraOffByChoice"] is True
