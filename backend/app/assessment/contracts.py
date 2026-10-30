"""Assessment contracts — port of backend-trial/node/assessment/contracts.mjs."""

from __future__ import annotations

import re
from typing import Any


class AssessmentError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


def check(condition: Any, message: str, status: int = 400) -> None:
    if not condition:
        raise AssessmentError(status, message)


def text(value: Any, name: str, max_len: int = 2000) -> str:
    check(isinstance(value, str) and value.strip() and len(value) <= max_len, f"Invalid {name}")
    return value.strip()


def strings(value: Any, name: str, max_len: int = 20) -> list[str]:
    check(isinstance(value, list) and len(value) <= max_len, f"Invalid {name}")
    return [text(v, name) for v in value]


VERSION = "structured-assessment-v1"
BLUEPRINT = [
    "ownership",
    "core_knowledge",
    "practical_application",
    "problem_solving",
    "troubleshooting",
    "specialization",
    "deeper_reasoning",
]


def validate_competencies(value: Any) -> list[dict]:
    check(isinstance(value, list) and len(value) == 7, "Exactly seven competencies required")
    result = []
    for c in value:
        check(isinstance(c, dict), "Invalid competency")
        result.append(
            {
                "id": text(c.get("id"), "competency id", 80),
                "name": text(c.get("name"), "competency name", 200),
                "requirement": text(c.get("requirement"), "job requirement", 2000),
                "weight": c.get("weight"),
            }
        )
    check(len({c["id"] for c in result}) == 7, "Competency IDs must be unique")
    check(all(isinstance(c["weight"], (int, float)) and 0 < c["weight"] <= 100 for c in result), "Invalid competency weights")
    check(abs(sum(c["weight"] for c in result) - 100) < 1e-6, "Weights must total 100")
    return result


def validate_plan(value: Any, job: dict, resume_text: str = "") -> dict:
    check(value and isinstance(value.get("questions"), list) and len(value["questions"]) == 7, "Exactly seven questions required")
    questions = []
    for index, q in enumerate(value["questions"]):
        check(isinstance(q, dict), "Invalid question")
        competency = next((c for c in job["competencies"] if c["id"] == q.get("competency")), None)
        check(competency, "Unknown competency")
        check(q.get("difficulty") in ("basic", "intermediate", "advanced"), "Invalid difficulty")
        check(
            q.get("question_type") in ("experience", "conceptual", "scenario", "practical", "design", "behavioral"),
            "Invalid question type",
        )
        check(q.get("max_score") == 4, "Maximum score must be 4")
        rubric_in = q.get("scoring_rubric")
        check(isinstance(rubric_in, dict), "Rubric required")
        rubric = {str(n): text(rubric_in.get(str(n), rubric_in.get(n)), "rubric anchor") for n in range(5)}
        evidence = text(q.get("resume_or_job_evidence"), "relevance evidence", 2000)
        sources = [resume_text or "", job.get("description") or "", competency["requirement"]]
        check(any(evidence in src for src in sources), "Relevance evidence must quote the supplied resume or job requirement")
        points = strings(q.get("expected_answer_points"), "expected answer points")
        check(points, "Expected answer points required")
        questions.append(
            {
                "question_id": text(q.get("question_id"), "question id", 80),
                "question_text": text(q.get("question_text"), "question text", 3000),
                "competency": competency["id"],
                "difficulty": q["difficulty"],
                "question_type": q["question_type"],
                "selection_reason": text(q.get("selection_reason"), "selection reason"),
                "resume_or_job_evidence": evidence,
                "expected_answer_points": points,
                "scoring_rubric": rubric,
                "suggested_follow_up": text(q.get("suggested_follow_up"), "follow-up", 1500),
                "max_score": 4,
                "time_guidance": str(q["time_guidance"])[:200] if isinstance(q.get("time_guidance"), str) else None,
                "position": index,
            }
        )
    check(len({q["question_id"] for q in questions}) == 7, "Duplicate question IDs")
    norms = {re.sub(r"[^\w]+", " ", q["question_text"].lower(), flags=re.UNICODE).strip() for q in questions}
    check(len(norms) == 7, "Duplicate questions")
    check(len({q["competency"] for q in questions}) == 7, "Each competency must be covered once")
    return {"questions": questions, "rubric_version": VERSION}


def validate_evaluation(value: Any, answer: str) -> dict:
    check(isinstance(value, dict) and isinstance(value.get("score"), int) and 0 <= value["score"] <= 4, "Invalid evaluation score")
    evidence = strings(value.get("evidence"), "evidence")
    check(all(quote in answer for quote in evidence), "Evaluation evidence must quote the answer exactly")
    check(value["score"] == 0 or evidence, "Positive scores require answer evidence")
    check(isinstance(value.get("confidence"), (int, float)) and 0 <= value["confidence"] <= 1, "Invalid confidence")
    check(isinstance(value.get("needs_human_review"), bool), "Review flag required")
    improvements = strings(value["improvements"], "improvements") if value.get("improvements") is not None else strings(value.get("gaps"), "gaps")
    return {
        "score": value["score"],
        "evidence": evidence,
        "strengths": strings(value.get("strengths"), "strengths"),
        "gaps": strings(value.get("gaps"), "gaps"),
        "improvements": improvements,
        "reasoning": text(value.get("reasoning"), "reasoning", 4000),
        "confidence": value["confidence"],
        "needs_human_review": value["needs_human_review"] or value["confidence"] < 0.7,
        "review_reason": text(value.get("review_reason"), "review reason")
        if value["needs_human_review"]
        else ("Low assessment confidence" if value["confidence"] < 0.7 else ""),
    }


def public_question(q: dict | None) -> dict | None:
    if not q:
        return None
    return {
        "question_id": q.get("question_id"),
        "question_text": q.get("question_text"),
        "competency": q.get("competency"),
        "difficulty": q.get("difficulty"),
        "question_type": q.get("question_type"),
        "time_guidance": q.get("time_guidance"),
    }


def aggregate(job: dict, questions: list, answers: list, evaluations: list, reviews: list | None = None) -> dict:
    reviews = reviews or []
    validate_competencies(job["competencies"])
    scores = []
    for q in questions:
        answer = next((a for a in answers if a.get("question_id") == q.get("question_id")), None)
        evaluation = next((e for e in evaluations if answer and e.get("answer_id") == answer.get("id")), None)
        review = None
        if evaluation:
            matched = [r for r in reviews if r.get("evaluation_id") == evaluation.get("id")]
            review = matched[-1] if matched else None
        data = evaluation.get("data") if evaluation else None
        if isinstance(data, str):
            import json

            data = json.loads(data)
        score = review["score"] if review else (data or {}).get("score") if data else None
        weight = next(c["weight"] for c in job["competencies"] if c["id"] == q.get("competency"))
        scores.append(
            {
                "competency": q.get("competency"),
                "question_id": q.get("question_id"),
                "weight": weight,
                "score": score,
                "contribution": None if score is None else score / 4 * weight,
                "needs_human_review": (not evaluation) or (not review and bool((data or {}).get("needs_human_review"))),
            }
        )
    complete = all(s["score"] is not None for s in scores)
    return {
        "competencies": scores,
        "overall": round(sum(s["contribution"] for s in scores) * 100) / 100 if complete else None,
        "evaluated_weight": sum(s["weight"] for s in scores if s["score"] is not None),
        "needs_human_review": any(s["needs_human_review"] for s in scores),
        "notice": "AI-generated assessment for human review; not a hiring decision. Missing evidence is not proof of incompetence.",
    }
