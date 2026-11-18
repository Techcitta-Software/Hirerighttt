"""Role catalog skills vs résumé and interview answers — mirrors backend/node/roleSkillsFitScoring.mjs."""

from __future__ import annotations

import re
from typing import Any


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _clamp(n: float, lo: int = 0, hi: int = 100) -> int:
    return max(lo, min(hi, round(float(n or 0))))


def _canonical(value: str) -> str:
    return re.sub(r"[^a-z0-9+#]", "", value.lower().replace(".js", ""))


def _skill_tokens(skill: str) -> list[str]:
    c = _canonical(skill)
    parts = [
        re.sub(r"[^a-z0-9+#]", "", p)
        for p in re.split(r"[\s/&,+-]+", _clean(skill).lower())
        if len(re.sub(r"[^a-z0-9+#]", "", p)) >= 2
    ]
    out = [c, *parts]
    # "LLMs" must match an answer that says "LLM" (and "APIs" -> "API"): add the singular form too.
    out += [p[:-1] for p in out if len(p) >= 4 and p.endswith("s") and not p.endswith("ss")]
    return list(dict.fromkeys([p for p in out if p]))


def _blob_includes_skill(blob: str, skill: str) -> bool:
    lower = blob.lower()
    for token in _skill_tokens(skill):
        if len(token) >= 4 and token in lower:
            return True
        if len(token) >= 2 and re.search(
            rf"(^|[^a-z0-9]){re.escape(token)}([^a-z0-9]|$)", lower, re.I
        ):
            return True
    ckey = _canonical(skill)
    if "machinelearning" in ckey or "mlfundamental" in ckey:
        return bool(re.search(r"\bmachine learning\b|\bml\b|scikit|sklearn|classifier|model", lower, re.I))
    if "pythonprogramming" in ckey or ckey == "python":
        return bool(re.search(r"\bpython\b", lower, re.I))
    return False


def normalize_required_role_skills(required_skills: list[str] | None) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in required_skills or []:
        s = _clean(raw)
        if not s or s in seen:
            continue
        seen.add(s)
        out.append(s)
        if len(out) >= 3:
            break
    return out


def skill_evidence_on_resume(skill: str, ctx: dict[str, Any]) -> bool:
    blob = " ".join([*(ctx.get("skills") or []), _clean(ctx.get("resumeSnippet"))])
    return _blob_includes_skill(blob, skill)


def skill_evidence_in_answer(skill: str, answer: str) -> bool:
    return _blob_includes_skill(_clean(answer), skill)


def compute_question_role_skills_fit(
    question: dict[str, Any], answer: str, ctx: dict[str, Any], required_skills: list[str]
) -> int | None:
    required = normalize_required_role_skills(required_skills)
    if not required:
        return None

    q_text = f"{_clean(question.get('topic'))} {_clean(question.get('text'))}".lower()
    targeted = None
    for s in required:
        if _clean(s).lower() in q_text:
            targeted = s
            break
    if not targeted:
        for s in required:
            if any(len(t) >= 3 and t in q_text for t in _skill_tokens(s)):
                targeted = s
                break

    if targeted:
        on_resume = skill_evidence_on_resume(targeted, ctx)
        in_answer = skill_evidence_in_answer(targeted, answer)
        if on_resume and in_answer:
            return 100
        if on_resume and not in_answer:
            return 52
        if not on_resume and in_answer:
            return 68
        return 22

    # The question is not about a required role skill (e.g. opening, microservices design). Penalising the
    # answer for not naming React/Node/SQL would punish good answers, so this sub-score does not apply.
    return None


def compute_session_role_skills_fit(
    ctx: dict[str, Any], required_skills: list[str], answers: list[str]
) -> dict[str, Any]:
    required = normalize_required_role_skills(required_skills)
    if not required:
        return {
            "fitScore": 0,
            "requiredSkills": [],
            "onResume": [],
            "evidencedInAnswers": [],
            "resumeMatchCount": 0,
            "answerMatchCount": 0,
        }

    joined = " ".join(_clean(a) for a in answers)
    on_resume = [s for s in required if skill_evidence_on_resume(s, ctx)]
    evidenced = [s for s in required if skill_evidence_in_answer(s, joined)]
    n = len(required)
    fit_score = _clamp((len(on_resume) / n) * 50 + (len(evidenced) / n) * 50)
    return {
        "fitScore": fit_score,
        "requiredSkills": required,
        "onResume": on_resume,
        "evidencedInAnswers": evidenced,
        "resumeMatchCount": len(on_resume),
        "answerMatchCount": len(evidenced),
    }


def question_targets_skill(question: dict[str, Any], skill: str) -> bool:
    q_text = f"{_clean(question.get('topic'))} {_clean(question.get('text'))}".lower()
    return _clean(skill).lower() in q_text or any(len(tok) >= 3 and tok in q_text for tok in _skill_tokens(skill))


def compute_session_role_skills_fit_scored(
    ctx: dict[str, Any],
    required_skills: list[str],
    questions: list[dict[str, Any]],
    answers: list[str],
    answer_scores: list[int | None],
) -> dict[str, Any]:
    """Role fit using the evaluator's per-answer scores, so it measures demonstrated skill, not keywords.

    A required skill is evidenced when
      * it is named in an answer that scored at least 50 (buzzwords inside a wrong answer do not count), or
      * a question about that skill was answered well (score >= 60), even if the answer never repeated its name
        (a correct explanation of Python generators is evidence of Python).
    """
    base = compute_session_role_skills_fit(ctx, required_skills, [])
    required = base["requiredSkills"]
    if not required:
        return base
    evidenced: list[str] = []
    for skill in required:
        for i, answer in enumerate(answers):
            score = answer_scores[i] if i < len(answer_scores) else None
            if score is None:
                continue
            q = questions[i] if i < len(questions) else {}
            if (score >= 50 and skill_evidence_in_answer(skill, answer)) or (score >= 60 and question_targets_skill(q, skill)):
                evidenced.append(skill)
                break
    on_resume = base["onResume"]
    n = len(required)
    return {
        **base,
        "fitScore": _clamp((len(on_resume) / n) * 50 + (len(evidenced) / n) * 50),
        "evidencedInAnswers": evidenced,
        "answerMatchCount": len(evidenced),
        "evidenceRule": "answer-quality",
    }
