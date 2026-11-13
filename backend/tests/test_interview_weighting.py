"""Per-question weighting: technical 15%, every other question 10%, the remainder from role fit."""

from __future__ import annotations

import pytest

from app.services import interview_weighting as w
from app.services.interview_agent import score_session

LONG = (
    "In my last project I built a REST API with Python and FastAPI because the team needed low latency, "
    "then I added PostgreSQL indexes which reduced query time by 40%, and as a result the dashboard loaded faster. "
    "For example I also wrote tests and deployed it with Docker."
)


def q(focus: str, category: str, text: str = "Explain it.") -> dict:
    return {"focus": focus, "category": category, "text": text, "topic": category}


FRESHER_PLAN = [
    q("structured-fresher-intro", "Experience", "Tell me about yourself."),
    q("structured-theory-2", "Technical", "Explain REST APIs."),
    q("structured-theory-3", "Technical", "Explain database indexes."),
    q("structured-theory-4", "Technical", "Explain Docker containers."),
    q("structured-project-1", "Experience", "Describe your recent project."),
    q("structured-project-2", "Experience", "Describe another project."),
    q("structured-closing", "Communication", "Anything to add?"),
]
PROFILE = {"skills": ["Python", "FastAPI", "PostgreSQL"], "resumeText": "Python FastAPI PostgreSQL student projects", "totalExperience": "Fresher / 0 years"}


def run(questions, answers, profile=PROFILE, level="Fresher"):
    return score_session(role="Backend Developer", level=level, questions=questions, answers=answers, profile=profile, integrity={}, name="Test")


def analysis(score: int, rubrics=None) -> dict:
    return {"score": score, "answer": "x", "rubrics": rubrics or []}


def test_weights_add_up_for_fresher_and_experienced():
    f = w.compute_weighted_score(questions=FRESHER_PLAN[:6], analyses=[analysis(0)] * 6, fresher=True, role_fit_score=0)["model"]
    assert (f["technicalQuestionWeight"], f["otherQuestionWeight"], f["roleFitWeight"]) == (15.0, 10.0, 25.0)
    e = w.compute_weighted_score(questions=FRESHER_PLAN[:6], analyses=[analysis(0)] * 6, fresher=False, role_fit_score=0)["model"]
    assert e["roleFitWeight"] == 15.0  # 3x15 + 4x10 = 85


def test_one_answered_question_can_no_longer_stand_for_the_interview():
    # the reported bug: one answer used to be 100% of the score
    out = w.compute_weighted_score(questions=[FRESHER_PLAN[1]], analyses=[analysis(100)], fresher=True, role_fit_score=0)
    assert out["overall"] == 15  # a perfect technical answer is worth 15 points, nothing more
    assert out["model"]["answeredQuestions"] == 1 and out["model"]["plannedQuestions"] == 6


def test_a_perfect_non_technical_answer_is_worth_ten():
    out = w.compute_weighted_score(questions=[FRESHER_PLAN[0]], analyses=[analysis(100)], fresher=True, role_fit_score=0)
    assert out["overall"] == 10


def test_role_fit_fills_the_remainder():
    out = w.compute_weighted_score(questions=[], analyses=[], fresher=True, role_fit_score=100)
    assert out["overall"] == 25
    out = w.compute_weighted_score(questions=FRESHER_PLAN[:6], analyses=[analysis(100)] * 6, fresher=True, role_fit_score=100)
    assert out["overall"] == 100  # 45 + 30 + 25


def test_perfect_everything_for_an_experienced_candidate_is_100():
    qs = FRESHER_PLAN[:6] + [q("structured-fallback-recent", "Experience")]
    out = w.compute_weighted_score(questions=qs, analyses=[analysis(100)] * 7, fresher=False, role_fit_score=100)
    assert out["overall"] == 100


def test_the_closing_question_is_not_scored():
    out = w.compute_weighted_score(questions=FRESHER_PLAN, analyses=[analysis(100)] * 7, fresher=True, role_fit_score=0)
    assert out["overall"] == 75 and len(out["model"]["rows"]) == 6


def test_each_row_reports_its_share_and_points():
    out = w.compute_weighted_score(questions=FRESHER_PLAN[:2], analyses=[analysis(50), analysis(80)], fresher=True, role_fit_score=40)
    rows = out["model"]["rows"]
    assert rows[0] | {"label": ""} == {"label": "", "type": "other", "weight": 10.0, "score": 50, "points": 5.0, "answered": True}
    assert rows[1]["type"] == "technical" and rows[1]["weight"] == 15.0 and rows[1]["points"] == 12.0
    assert sum(1 for r in rows if not r["answered"]) == 4
    # 5 + 12 + 40% of 25 = 27
    assert out["overall"] == 27 and out["model"]["roleFitPoints"] == 10.0


def test_extra_questions_never_push_the_total_past_100():
    qs = [q(f"structured-theory-{i}", "Technical") for i in range(9)]
    qs += [q("structured-project-1", "Experience")] * 3
    out = w.compute_weighted_score(questions=qs, analyses=[analysis(100)] * 12, fresher=True, role_fit_score=100)
    assert out["overall"] == 100  # every slot perfect, shares shrunk to fit: still exactly 100, never more
    assert out["model"]["roleFitWeight"] >= w.MIN_ROLE_FIT_WEIGHT


def test_dimensions_count_unanswered_questions_as_zero():
    rub = [{"id": "communication", "score": 50}, {"id": "depth", "score": 50}]
    out = w.compute_weighted_score(questions=[FRESHER_PLAN[1]], analyses=[analysis(50, rub)], fresher=True, role_fit_score=70)
    dims = {d["id"]: d["score"] for d in out["dimensions"]}
    # one technical answer of 50 out of 75 points of questions: 15*50/75 = 10
    assert dims["communication"] == 10 and dims["depth"] == 10
    assert dims["roleSkillsFit"] == 70
    assert "correctness" not in dims  # never evaluated -> never reported as a made-up 0


def test_end_to_end_one_answer_gets_a_low_honest_score_with_a_notice():
    out = run(FRESHER_PLAN[:2], [LONG, ""])
    assert out["overall"] < 30
    assert out["scoreModel"]["answeredQuestions"] == 1
    assert "planned questions were answered" in (out["scoring"]["notice"] or "")
    comm = next(c for c in out["categories"] if c["label"] == "Communication")
    assert comm["score"] < 25  # not the 50+ a single answer used to show


def test_end_to_end_same_result_whether_unanswered_questions_are_sent_or_not():
    only_one = run(FRESHER_PLAN[:1], [LONG])
    all_sent = run(FRESHER_PLAN, [LONG, "", "", "", "", "", ""])
    assert only_one["overall"] == all_sent["overall"]


def test_end_to_end_a_full_set_of_good_answers_scores_much_higher():
    answers = [LONG] * 6 + [""]
    full = run(FRESHER_PLAN, answers)
    one = run(FRESHER_PLAN[:1], [LONG])
    assert full["overall"] > one["overall"] + 25
    assert full["scoreModel"]["answeredQuestions"] == 6
    assert full["scoring"]["notice"] and "planned questions were answered" not in full["scoring"]["notice"]


def test_banned_session_is_still_zero():
    out = score_session(
        role="Backend Developer", level="Fresher", questions=FRESHER_PLAN[:2], answers=[LONG, LONG], profile=PROFILE,
        integrity={"banned": True, "banReason": "test"}, name="T",
    )
    assert out["overall"] == 0


@pytest.mark.parametrize("fresher,expected_role", [(True, 25.0), (False, 15.0)])
def test_role_fit_weight_by_candidate_type(fresher, expected_role):
    out = w.compute_weighted_score(questions=[], analyses=[], fresher=fresher, role_fit_score=0)
    assert out["model"]["roleFitWeight"] == expected_role
