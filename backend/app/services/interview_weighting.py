"""How the interview's overall score is put together from its questions.

Every scored question carries a fixed share of the final score, and whatever share is left over comes from how well
the candidate's skills fit the role:

    technical question        15 points of the 100
    every other question      10 points of the 100   (opening, projects, anything else)
    role skills fit           the remainder

A fresher interview is 3 technical + 3 other questions (the closing question is not scored): 45 + 30 = 75, so role fit
is worth 25. An experienced interview adds a fallback question: 45 + 40 = 85, so role fit is worth 15.

The shares belong to the planned questions, not to the answers that happen to arrive. A question that was not
answered contributes 0 but keeps its share, so stopping after one question can never produce a high score: with one
technical answer worth 80 the candidate earns 80 x 15% = 12 points, plus the role-fit share.

Within a question, the score is still the weighted mix of Correctness / Depth / Communication (see
interview_rubric_scoring). That is unchanged; this module decides only how the questions combine.
"""

from __future__ import annotations

from typing import Any

from app.services.interview_rubric_scoring import INTERVIEW_RUBRICS, classify_question_scoring_profile

TECHNICAL_WEIGHT = 15.0
OTHER_WEIGHT = 10.0
# Never let questions use up the whole score: role fit always keeps at least this much.
MIN_ROLE_FIT_WEIGHT = 10.0

_CLOSING_FOCUS = ("structured-closing", "pending-closing")


def planned_slots(fresher: bool) -> dict[str, int]:
    """Scored questions an interview is meant to have (the closing question is not scored)."""
    return {"technical": 3, "other": 3 if fresher else 4}


def is_closing(question: dict[str, Any] | None) -> bool:
    return str((question or {}).get("focus") or "") in _CLOSING_FOCUS


def is_technical(question: dict[str, Any] | None) -> bool:
    return classify_question_scoring_profile(question or {}) == "technical"


def _label(question: dict[str, Any], index: int) -> str:
    return str(question.get("topic") or question.get("category") or f"Question {index + 1}").strip()[:60]


def compute_weighted_score(
    *,
    questions: list[dict[str, Any]],
    analyses: list[dict[str, Any]],
    fresher: bool,
    role_fit_score: int,
) -> dict[str, Any]:
    """Return the overall score and a full breakdown of where every point came from."""
    answered: list[dict[str, Any]] = []
    for i, (q, a) in enumerate(zip(questions, analyses)):
        if is_closing(q):
            continue
        answered.append({"index": i, "question": q, "analysis": a, "technical": is_technical(q)})

    plan = planned_slots(fresher)
    n_tech = max(plan["technical"], sum(1 for x in answered if x["technical"]))
    n_other = max(plan["other"], sum(1 for x in answered if not x["technical"]))
    w_tech, w_other = TECHNICAL_WEIGHT, OTHER_WEIGHT

    question_total = w_tech * n_tech + w_other * n_other
    cap = 100.0 - MIN_ROLE_FIT_WEIGHT
    if question_total > cap:  # an unusually long interview: shrink question shares proportionally
        scale = cap / question_total
        w_tech, w_other, question_total = w_tech * scale, w_other * scale, cap
    role_weight = 100.0 - question_total

    rows: list[dict[str, Any]] = []
    earned = 0.0
    for x in answered:
        weight = w_tech if x["technical"] else w_other
        score = int(x["analysis"].get("score") or 0)
        points = weight * score / 100.0
        earned += points
        rows.append(
            {
                "label": _label(x["question"], x["index"]),
                "type": "technical" if x["technical"] else "other",
                "weight": round(weight, 1),
                "score": score,
                "points": round(points, 1),
                "answered": True,
            }
        )
    missing_tech = n_tech - sum(1 for x in answered if x["technical"])
    missing_other = n_other - sum(1 for x in answered if not x["technical"])
    for kind, count, weight in (("technical", missing_tech, w_tech), ("other", missing_other, w_other)):
        for _ in range(max(0, count)):
            rows.append(
                {"label": "Not asked / not answered", "type": kind, "weight": round(weight, 1), "score": 0, "points": 0.0, "answered": False}
            )

    role_points = role_weight * max(0, min(100, int(role_fit_score))) / 100.0
    overall = max(0, min(100, round(earned + role_points)))

    # Dimension scores across the whole plan: a question nobody answered counts as 0 for its share, so one good
    # answer can no longer stand in for the whole interview.
    dimensions: list[dict[str, Any]] = []
    for defn in INTERVIEW_RUBRICS:
        rid = defn["id"]
        if rid == "roleSkillsFit":
            dimensions.append({"id": rid, "label": defn["label"], "score": max(0, min(100, int(role_fit_score)))})
            continue
        numerator = 0.0
        denominator = question_total
        seen = False
        for x in answered:
            weight = w_tech if x["technical"] else w_other
            value = next((r.get("score") for r in (x["analysis"].get("rubrics") or []) if r.get("id") == rid), None)
            if value is None:
                denominator -= weight  # this dimension was not evaluated for that question
                continue
            seen = True
            numerator += weight * int(value)
        if seen and denominator > 0:
            dimensions.append({"id": rid, "label": defn["label"], "score": max(0, min(100, round(numerator / denominator)))})

    return {
        "overall": overall,
        "dimensions": dimensions,
        "model": {
            "technicalQuestionWeight": round(w_tech, 1),
            "otherQuestionWeight": round(w_other, 1),
            "roleFitWeight": round(role_weight, 1),
            "plannedQuestions": n_tech + n_other,
            "answeredQuestions": sum(1 for x in answered if str(x["analysis"].get("answer") or "").strip()),
            "questionPoints": round(earned, 1),
            "roleFitPoints": round(role_points, 1),
            "roleFitScore": max(0, min(100, int(role_fit_score))),
            "rows": rows,
        },
    }
