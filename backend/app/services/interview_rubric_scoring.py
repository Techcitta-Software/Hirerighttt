"""Interview rubrics — mirrors frontend/src/lib/interviewRubrics.ts and backend/node/interviewRubricScoring.mjs."""

from __future__ import annotations

import re
from typing import Any

INTERVIEW_RUBRICS = [
    {"id": "correctness", "label": "Answer Correctness"},
    {"id": "depth", "label": "Depth"},
    {"id": "communication", "label": "Communication"},
]

RUBRIC_WEIGHT_BY_PROFILE: dict[str, dict[str, float]] = {
    "opening_generic": {"correctness": 0.0, "depth": 0.2, "communication": 0.8},
    "technical": {"correctness": 0.5, "depth": 0.3, "communication": 0.2},
    "experience": {"correctness": 0.32, "depth": 0.33, "communication": 0.35},
    "project": {"correctness": 0.4, "depth": 0.3, "communication": 0.3},
    "behavioral": {"correctness": 0.18, "depth": 0.22, "communication": 0.6},
    "balanced": {"correctness": 0.34, "depth": 0.33, "communication": 0.33},
}

STRUCTURE_SIGNALS = [
    "for example",
    "first",
    "then",
    "finally",
    "as a result",
    "because",
    "situation",
    "task",
    "action",
    "result",
    "so i",
    "which led",
    "in the end",
]


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _clamp(n: float, lo: int = 0, hi: int = 100) -> int:
    return max(lo, min(hi, round(float(n or 0))))


def classify_question_scoring_profile(question: dict[str, Any]) -> str:
    explicit = _clean(question.get("scoringProfile")).lower()
    if explicit in RUBRIC_WEIGHT_BY_PROFILE:
        return explicit

    focus = _clean(question.get("focus")).lower()
    cat = _clean(question.get("category"))
    text = _clean(question.get("text")).lower()
    topic = _clean(question.get("topic")).lower()

    if "structured-opening" in focus or "structured-fresher-intro" in focus:
        return "opening_generic"
    if "structured-theory" in focus or "structured-skill" in focus or "jd-first" in focus:
        return "technical"
    if cat == "Technical" and "structured-opening" not in focus:
        return "technical"
    if "structured-fallback-recent" in focus:
        return "project"
    if (
        "structured-recent-project" in focus
        or "structured-project" in focus
        or "structured-cert" in focus
        or re.search(r"project|certification|credential", topic)
    ):
        return "project"
    if "structured-work" in focus or (cat == "Experience" and "structured-opening" not in focus):
        return "experience"
    if "structured-closing" in focus or cat == "Communication":
        return "behavioral"
    if re.search(r"\bproject\b|\bbuilt\b|\bshipped\b|\bcertification\b", text):
        return "project"
    if re.search(r"\btechnical\b|\bskill\b|\barchitect|\bapi\b|\bdatabase\b|\bstack\b", text):
        return "technical"
    if re.search(r"\bwhy\b|\bfitc\b|\bstrength\b|\bmotivat", text):
        return "behavioral"
    return "balanced"


def get_rubric_weights(profile: str) -> dict[str, float]:
    return dict(RUBRIC_WEIGHT_BY_PROFILE.get(profile) or RUBRIC_WEIGHT_BY_PROFILE["balanced"])


def _word_count_band_score(word_count: int) -> int:
    if word_count < 8:
        return 15
    if word_count < 25:
        return 45
    if word_count < 45:
        return 72
    if word_count <= 180:
        return 100
    if word_count <= 260:
        return 78
    return 55


def compute_heuristic_rubric_scores(question: dict[str, Any], answer: str, ctx: dict[str, Any]) -> dict[str, Any]:
    text = _clean(answer)
    lower = text.lower()
    words = [w for w in text.split() if w]
    word_count = len(words)

    keywords = [str(k).lower() for k in (question.get("keywords") or []) if k]
    keywords_hit = [k for k in keywords if k in lower]
    keyword_coverage = (
        round((len(keywords_hit) / min(len(keywords), 6)) * 100)
        if keywords
        else (65 if word_count >= 20 else 30)
    )

    skills = ctx.get("skills") or []
    skills_hit = [s for s in skills if len(str(s)) >= 2 and str(s).lower() in lower]
    jobs = ctx.get("jobs") or []
    company_tokens: list[str] = []
    for j in jobs:
        for part in re.split(r"[@:]", str(j)):
            t = part.strip().lower()
            if len(t) >= 3 and t not in ("role", "company", "at"):
                company_tokens.append(t)
    companies_hit = [t for t in company_tokens if t in lower]
    anchor = _clean(question.get("resumeAnchor")).lower()
    anchor_hit = len(anchor) >= 3 and anchor in lower

    correctness = min(
        100,
        round(keyword_coverage * 0.45 + len(skills_hit) * 12 + len(companies_hit) * 10 + (15 if anchor_hit else 0)),
    )
    if word_count < 10:
        correctness = min(correctness, 25)
    if word_count < 5:
        correctness = 10

    has_numbers = bool(re.search(r"\d", text))
    has_metrics = bool(
        re.search(r"\b(\d+\s*%|\$\d|percent|increase|reduce|saved|improved|latency|throughput|users)\b", text, re.I)
    )
    has_tools = bool(
        re.search(
            r"\b(react|node|python|sql|aws|docker|typescript|java|kafka|postgres|kubernetes|api|microservice)\b",
            text,
            re.I,
        )
    )
    outcome_words = len(re.findall(r"\b(built|shipped|led|fixed|designed|implemented|delivered|migrated|owned)\b", text, re.I))
    depth = 22
    if word_count >= 35:
        depth += 18
    if word_count >= 60:
        depth += 12
    if has_numbers:
        depth += 14
    if has_metrics:
        depth += 16
    if has_tools:
        depth += 12
    depth += min(18, outcome_words * 4)
    depth += min(12, len(skills_hit) * 4)
    depth = _clamp(depth)

    structure_hits = sum(1 for s in STRUCTURE_SIGNALS if s in lower)
    clarity_band = _word_count_band_score(word_count)
    filler_penalty = 10 if re.search(r"\b(um+|uh+|like,|you know)\b", text, re.I) else 0
    communication = _clamp(clarity_band * 0.55 + min(100, (structure_hits / 3) * 100) * 0.45 - filler_penalty)
    if word_count < 8:
        communication = min(communication, 20)

    profile = classify_question_scoring_profile(question)
    return {
        "correctness": correctness,
        "depth": depth,
        "communication": communication,
        "wordCount": word_count,
        "keywordsHit": list(dict.fromkeys([*keywords_hit, *[str(s) for s in skills_hit]])),
        "skillsHit": skills_hit,
        "scoringProfile": profile,
    }


def merge_rubric_scores(heuristic: dict[str, Any], llm: dict[str, Any] | None) -> dict[str, Any]:
    if not llm:
        return {**heuristic, "source": "heuristic"}

    def blend(h: float, l: float, llm_weight: float) -> int:
        return _clamp(h * (1 - llm_weight) + l * llm_weight)

    correctness = (
        _clamp(llm["correctness"])
        if isinstance(llm.get("correctness"), (int, float))
        else heuristic["correctness"]
    )
    depth = (
        blend(heuristic["depth"], llm["depth"], 0.4)
        if isinstance(llm.get("depth"), (int, float))
        else heuristic["depth"]
    )
    communication = (
        blend(heuristic["communication"], llm["communication"], 0.35)
        if isinstance(llm.get("communication"), (int, float))
        else heuristic["communication"]
    )
    feedback = _clean(llm.get("feedback")) or None
    return {
        "correctness": correctness,
        "depth": depth,
        "communication": communication,
        "feedback": feedback,
        "source": "llm+heuristic",
    }


def build_weighted_rubrics(scores: dict[str, Any], profile: str) -> list[dict[str, Any]]:
    weights = get_rubric_weights(profile)
    out = []
    for defn in INTERVIEW_RUBRICS:
        rid = defn["id"]
        out.append(
            {
                "id": rid,
                "label": defn["label"],
                "weight": weights.get(rid, 0.33),
                "score": _clamp(scores.get(rid, 0)),
            }
        )
    return out


def weighted_question_score(rubrics: list[dict[str, Any]]) -> int:
    total = sum(r["score"] * r["weight"] for r in rubrics)
    return _clamp(total)
