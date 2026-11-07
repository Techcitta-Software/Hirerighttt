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
