"""Interview rubrics — mirrors frontend/src/lib/interviewRubrics.ts and backend/node/interviewRubricScoring.mjs."""

from __future__ import annotations

import re
from typing import Any

INTERVIEW_RUBRICS = [
    {"id": "correctness", "label": "Answer Correctness"},
    {"id": "depth", "label": "Depth"},
    {"id": "communication", "label": "Communication"},
    {"id": "roleSkillsFit", "label": "Role Skills Fit"},
]

RUBRIC_WEIGHT_BY_PROFILE: dict[str, dict[str, float]] = {
    "opening_generic": {"correctness": 0.0, "depth": 0.15, "communication": 0.55, "roleSkillsFit": 0.3},
    "technical": {"correctness": 0.45, "depth": 0.25, "communication": 0.15, "roleSkillsFit": 0.15},
    "experience": {"correctness": 0.28, "depth": 0.27, "communication": 0.25, "roleSkillsFit": 0.2},
    "project": {"correctness": 0.35, "depth": 0.25, "communication": 0.25, "roleSkillsFit": 0.15},
    "behavioral": {"correctness": 0.15, "depth": 0.15, "communication": 0.5, "roleSkillsFit": 0.2},
    "balanced": {"correctness": 0.3, "depth": 0.25, "communication": 0.25, "roleSkillsFit": 0.2},
}

# Non-technical interviews only. roleSkillsFit stays at 0 so naming a tool cannot move the question score.
NONTECH_RUBRIC_WEIGHTS: dict[str, dict[str, float]] = {
    "opening": {"correctness": 0.20, "depth": 0.20, "communication": 0.60, "roleSkillsFit": 0.0},
    "situational": {"correctness": 0.40, "depth": 0.40, "communication": 0.20, "roleSkillsFit": 0.0},
    "stakeholder": {"correctness": 0.35, "depth": 0.40, "communication": 0.25, "roleSkillsFit": 0.0},
    "achievement": {"correctness": 0.25, "depth": 0.55, "communication": 0.20, "roleSkillsFit": 0.0},
    "followup": {"correctness": 0.35, "depth": 0.40, "communication": 0.25, "roleSkillsFit": 0.0},
    "communication": {"correctness": 0.15, "depth": 0.15, "communication": 0.70, "roleSkillsFit": 0.0},
}

NONTECH_RUBRIC_LABELS = {
    "correctness": "Situation fit",
    "depth": "Ownership & result",
    "communication": "Communication",
    "roleSkillsFit": "Role Skills Fit",
}

_OWNERSHIP_RE = re.compile(
    r"\b(decided|told|asked|called|emailed|wrote|sent|met|escalated|negotiated|refused|declined|approved|"
    r"prioritized|owned|scheduled|followed|took|hired|presented|recommended|convinced|closed|resolved|"
    r"renewed|retained|handled|collected|onboarded)\b",
    re.I,
)
_STAKEHOLDER_RE = re.compile(
    r"\b(client|customer|stakeholder|manager|director|executive|legal|finance|recruiter|candidate|vendor|"
    r"partner|teammate|team|user|boss|buyer|hiring)\b",
    re.I,
)
_OUTCOME_WORD_RE = re.compile(
    r"\b(saved|reduced|increased|signed|hired|launched|approved|declined|missed|delayed|delivered|result|outcome|quota)\b",
    re.I,
)
_VAGUE_PHRASES = (
    "somehow",
    "stuff",
    "things",
    "a lot",
    "various",
    "basically",
    "kind of",
    "sort of",
    "team player",
    "hard worker",
    "passionate",
    "synergy",
    "leverage",
    "circle back",
)
_WHY_ACTION_RESULT = "The answer states a personal action and a concrete result."
_WHY_ACTION_ONLY = "The answer states a personal action but no measurable result."
_WHY_STAKEHOLDER_ONLY = "The answer names a stakeholder but not what the candidate did."
_WHY_STRUCTURE_ONLY = "The answer is organized but does not pin down an action or a result."
_WHY_NONE = "No specific situation, action, or result was stated."

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


def is_non_technical_question(question: dict[str, Any] | None) -> bool:
    return str((question or {}).get("questionModel") or "") == "non_technical"


def non_technical_scoring_profile(question: dict[str, Any] | None) -> str:
    explicit = _clean((question or {}).get("scoringProfile")).lower()
    if explicit in NONTECH_RUBRIC_WEIGHTS:
        return explicit
    focus = _clean((question or {}).get("focus")).lower()
    if "opening" in focus:
        return "opening"
    if "closing" in focus:
        return "communication"
    return "situational"


def _collapse_ws(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def validated_evidence_quote(quote: str, answer: str) -> str:
    """At most 12 words, and only if it is still a substring of the answer after whitespace collapse."""
    collapsed_quote = _collapse_ws(quote)
    words = collapsed_quote.split()
    if len(words) > 12:
        collapsed_quote = " ".join(words[:12])
    collapsed_answer = _collapse_ws(answer)
    if collapsed_quote and collapsed_quote.lower() in collapsed_answer.lower():
        return collapsed_quote
    return ""


def _quote_around(answer: str, needle: str) -> str:
    collapsed = _collapse_ws(answer)
    words = collapsed.split()
    if not words:
        return ""
    if needle:
        idx = collapsed.lower().find(needle.lower())
        if idx >= 0:
            start = len(collapsed[:idx].split()) - (0 if collapsed[:idx].endswith(" ") or idx == 0 else 1)
            start = max(0, start)
            return validated_evidence_quote(" ".join(words[start : start + 12]), collapsed)
    return validated_evidence_quote(" ".join(words[:12]), collapsed)


def _nontech_evidence(answer: str, *, ownership: list[str], outcome: bool, stakeholder: bool, structure_hits: int) -> dict[str, dict[str, str]]:
    if ownership and outcome:
        why = _WHY_ACTION_RESULT
        quote = _quote_around(answer, ownership[0])
    elif ownership:
        why = _WHY_ACTION_ONLY
        quote = _quote_around(answer, ownership[0])
    elif stakeholder:
        why = _WHY_STAKEHOLDER_ONLY
        quote = _quote_around(answer, "")
    elif structure_hits:
        why = _WHY_STRUCTURE_ONLY
        quote = _quote_around(answer, "")
    else:
        why = _WHY_NONE
        quote = ""
    item = {"quote": quote, "why": why}
    return {"correctness": dict(item), "depth": dict(item), "communication": dict(item)}


def _communication_score(text: str, lower: str, word_count: int) -> tuple[int, int]:
    structure_hits = sum(1 for s in STRUCTURE_SIGNALS if s in lower)
    clarity_band = _word_count_band_score(word_count)
    filler_penalty = 10 if re.search(r"\b(um+|uh+|like,|you know)\b", text, re.I) else 0
    communication = _clamp(clarity_band * 0.55 + min(100, (structure_hits / 3) * 100) * 0.45 - filler_penalty)
    if word_count < 8:
        communication = min(communication, 20)
    return communication, structure_hits


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


def _lookfor_hit_ratio(
    question: dict[str, Any],
    lower: str,
    word_count: int,
    *,
    ownership: bool,
    stakeholder: bool,
    outcome: bool,
) -> float:
    items = question.get("lookFor") if isinstance(question.get("lookFor"), list) else []
    if not items:
        return 0.0
    hits = 0
    for item in items:
        token = str(item or "")
        key = token.lower()
        if key == "own_action" and ownership:
            hits += 1
        elif key == "stakeholder" and stakeholder:
            hits += 1
        elif key == "situation" and word_count >= 25:
            hits += 1
        elif key == "result" and outcome:
            hits += 1
        elif key.startswith("tool:") or key.startswith("employer:"):
            name = token.split(":", 1)[1].strip().lower()
            if name and name in lower:
                hits += 1
    return hits / len(items)


def _heuristic_non_technical(question: dict[str, Any], answer: str) -> dict[str, Any]:
    """Judgment scoring. Engineering tool names (React, Python, Docker, ...) add nothing."""
    text = _clean(answer)
    lower = text.lower()
    words = [w for w in text.split() if w]
    word_count = len(words)
    ownership = list(dict.fromkeys(m.group(0).lower() for m in _OWNERSHIP_RE.finditer(lower)))
    stakeholder = _STAKEHOLDER_RE.search(lower) is not None
    has_number = bool(re.search(r"\d", text))
    has_outcome_word = _OUTCOME_WORD_RE.search(lower) is not None
    has_mark = bool(re.search(r"%|\$", text))
    outcome = has_number or has_mark or has_outcome_word
    vague = sum(1 for phrase in _VAGUE_PHRASES if phrase in lower)
    hypothetical = len(ownership) == 0 and re.search(r"\bi would\b|\bi will\b|\bi could\b", lower) is not None
    communication, structure_hits = _communication_score(text, lower, word_count)
    ratio = _lookfor_hit_ratio(
        question, lower, word_count, ownership=bool(ownership), stakeholder=stakeholder, outcome=outcome
    )

    correctness = 20
    if word_count >= 25:
        correctness += 25
    if word_count >= 60:
        correctness += 15
    correctness += round(ratio * 40)
    if stakeholder:
        correctness += 10
    if word_count < 10:
        correctness = min(correctness, 25)
    if word_count < 5:
        correctness = min(correctness, 10)
    if vague >= 3 and not ownership:
        correctness = min(correctness, 40)
    if hypothetical:
        correctness = min(correctness, 55)
    correctness = _clamp(correctness)

    depth = 18
    if len(ownership) >= 1:
        depth += 16
    if len(ownership) >= 2:
        depth += 8
    if word_count >= 20 and not ownership:
        depth -= 12
    if has_number:
        depth += 14
    if has_outcome_word:
        depth += 16
    if structure_hits >= 2:
        depth += 12
    if word_count >= 40 and not ownership and not has_number and not has_outcome_word:
        depth = min(depth, 35)
    if hypothetical:
        depth = min(depth, 55)
    depth = _clamp(depth)

    return {
        "correctness": correctness,
        "depth": depth,
        "communication": communication,
        "wordCount": word_count,
        "keywordsHit": [],
        "skillsHit": [],
        "scoringProfile": non_technical_scoring_profile(question),
        "evidence": _nontech_evidence(
            text, ownership=ownership, outcome=outcome, stakeholder=stakeholder, structure_hits=structure_hits
        ),
    }


def compute_heuristic_rubric_scores(question: dict[str, Any], answer: str, ctx: dict[str, Any]) -> dict[str, Any]:
    if is_non_technical_question(question):
        return _heuristic_non_technical(question, answer)
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

    communication, _structure_hits = _communication_score(text, lower, word_count)

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
        return {
            "correctness": None,
            "depth": _clamp(heuristic["depth"]),
            "communication": _clamp(heuristic["communication"]),
            "roleSkillsFit": heuristic.get("roleSkillsFit"),
            "feedback": None,
            "source": "heuristic",
        }

    correctness = (
        _clamp(llm["correctness"]) if isinstance(llm.get("correctness"), (int, float)) else None
    )
    depth = (
        _clamp(llm["depth"]) if isinstance(llm.get("depth"), (int, float)) else _clamp(heuristic["depth"])
    )
    communication = (
        _clamp(llm["communication"])
        if isinstance(llm.get("communication"), (int, float))
        else _clamp(heuristic["communication"])
    )
    feedback = _clean(llm.get("feedback")) or None
    return {
        "correctness": correctness,
        "depth": depth,
        "communication": communication,
        "roleSkillsFit": heuristic.get("roleSkillsFit"),
        "feedback": feedback,
        "source": "llm",
    }


def build_weighted_rubrics(
    scores: dict[str, Any], profile: str, question: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    nontech = is_non_technical_question(question)
    if nontech:
        weights = dict(NONTECH_RUBRIC_WEIGHTS[non_technical_scoring_profile(question)])
        labels = NONTECH_RUBRIC_LABELS
    else:
        weights = get_rubric_weights(profile)
        labels = {defn["id"]: defn["label"] for defn in INTERVIEW_RUBRICS}
    out = []
    for defn in INTERVIEW_RUBRICS:
        rid = defn["id"]
        raw = scores.get(rid)
        score = None if raw is None else _clamp(raw)
        out.append(
            {
                "id": rid,
                "label": labels.get(rid, defn["label"]),
                "weight": weights.get(rid, 0.33),
                "score": score,
            }
        )
    return out


def weighted_question_score(rubrics: list[dict[str, Any]]) -> int:
    active = [r for r in rubrics if r.get("weight", 0) > 0 and r.get("score") is not None]
    weight_sum = sum(r["weight"] for r in active)
    if not weight_sum:
        return 0
    total = sum(r["score"] * (r["weight"] / weight_sum) for r in active)
    return _clamp(total)
