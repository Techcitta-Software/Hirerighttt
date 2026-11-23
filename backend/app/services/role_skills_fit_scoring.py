"""Role Skills Fit: a deterministic, explainable 0-100 score.

How the number is built (the same rule everywhere; the browser only displays what the API returns):

* Required skills come from the job (JD / recruiter's required skills) when the interview is for a job,
  otherwise from the role catalog (data/roleSkills.json), otherwise from the candidate's own resume skills.
  At most ``MAX_REQUIRED_SKILLS`` are used, in the order given.
* Each required skill earns up to 100 points:
    - ``RESUME_POINTS`` (40) when the skill is evidenced on the resume (parsed skills or resume text), and
    - ``INTERVIEW_POINTS`` (60) when it was demonstrated in the interview: an answer about that skill scored
      at least ``TARGETED_MIN_SCORE`` (60), or an answer that names the skill scored at least
      ``MENTION_MIN_SCORE`` (50). Buzzwords inside a weak answer do not count.
* Role Skills Fit = the average of the per-skill points, rounded.

No embeddings, cosine similarity or randomness: the same resume, questions, answers and answer scores always
produce the same number, and the response lists which skills matched and which were missed.
"""

from __future__ import annotations

import re
from typing import Any

MAX_REQUIRED_SKILLS = 6
RESUME_POINTS = 40
INTERVIEW_POINTS = 60
TARGETED_MIN_SCORE = 60
MENTION_MIN_SCORE = 50

METHOD_TEXT = (
    f"Each required skill earns {RESUME_POINTS} points when it is on the resume and {INTERVIEW_POINTS} points "
    f"when it was demonstrated in the interview (an answer about it scored {TARGETED_MIN_SCORE}+ or an answer "
    f"naming it scored {MENTION_MIN_SCORE}+). Role Skills Fit is the average across the required skills."
)


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


def normalize_required_role_skills(required_skills: list[str] | None, limit: int = MAX_REQUIRED_SKILLS) -> list[str]:
    """Trimmed, de-duplicated (case-insensitive) skills in the order given, at most ``limit``."""
    seen: set[str] = set()
    out: list[str] = []
    for raw in required_skills or []:
        s = _clean(raw)
        if not s or s.lower() in seen:
            continue
        seen.add(s.lower())
        out.append(s)
        if len(out) >= limit:
            break
    return out


def skill_evidence_on_resume(skill: str, ctx: dict[str, Any]) -> bool:
    blob = " ".join([*(str(s) for s in ctx.get("skills") or []), _clean(ctx.get("resumeSnippet"))])
    return _blob_includes_skill(blob, skill)


def skill_evidence_in_answer(skill: str, answer: str) -> bool:
    return _blob_includes_skill(_clean(answer), skill)


def question_targets_skill(question: dict[str, Any], skill: str) -> bool:
    q_text = f"{_clean(question.get('topic'))} {_clean(question.get('text'))}".lower()
    return _clean(skill).lower() in q_text or any(len(tok) >= 3 and tok in q_text for tok in _skill_tokens(skill))


def compute_question_role_skills_fit(
    question: dict[str, Any], answer: str, ctx: dict[str, Any], required_skills: list[str]
) -> int | None:
    """Per-answer rubric value for a question about one required skill (None when the question is about none).

    Same points as the session score: resume evidence 40 + named in the answer 60.
    """
    required = normalize_required_role_skills(required_skills)
    if not required:
        return None
    q_text = f"{_clean(question.get('topic'))} {_clean(question.get('text'))}".lower()
    targeted = next((s for s in required if _clean(s).lower() in q_text), None) or next(
        (s for s in required if question_targets_skill(question, s)), None
    )
    if not targeted:
        # Not about a required skill (opening, behavioural, system design): this sub-score does not apply.
        return None
    return (RESUME_POINTS if skill_evidence_on_resume(targeted, ctx) else 0) + (
        INTERVIEW_POINTS if skill_evidence_in_answer(targeted, answer) else 0
    )


def _empty_result(skill_source: str) -> dict[str, Any]:
    return {
        "fitScore": 0,
        "requiredSkills": [],
        "skills": [],
        "matchedSkills": [],
        "missingSkills": [],
        "onResume": [],
        "evidencedInAnswers": [],
        "resumeMatchCount": 0,
        "answerMatchCount": 0,
        "skillSource": skill_source,
        "weights": {"resume": RESUME_POINTS, "interview": INTERVIEW_POINTS},
        "method": METHOD_TEXT,
    }


def compute_role_skills_fit(
    ctx: dict[str, Any],
    required_skills: list[str] | None,
    questions: list[dict[str, Any]] | None,
    answers: list[str] | None,
    answer_scores: list[int | float | None] | None,
    *,
    skill_source: str = "role",
) -> dict[str, Any]:
    """The Role Skills Fit score and its per-skill breakdown (see the module docstring)."""
    required = normalize_required_role_skills(required_skills)
    if not required:
        return _empty_result(skill_source)
    questions = questions or []
    answers = answers or []
    answer_scores = answer_scores or []

    rows: list[dict[str, Any]] = []
    for skill in required:
        on_resume = skill_evidence_on_resume(skill, ctx)
        demonstrated_in: int | None = None
        for i, answer in enumerate(answers):
            score = answer_scores[i] if i < len(answer_scores) else None
            if score is None or not _clean(answer):
                continue
            q = questions[i] if i < len(questions) else {}
            if (score >= TARGETED_MIN_SCORE and question_targets_skill(q, skill)) or (
                score >= MENTION_MIN_SCORE and skill_evidence_in_answer(skill, answer)
            ):
                demonstrated_in = i + 1
                break
        points = (RESUME_POINTS if on_resume else 0) + (INTERVIEW_POINTS if demonstrated_in else 0)
        rows.append(
            {
                "skill": skill,
                "onResume": on_resume,
                "demonstrated": demonstrated_in is not None,
                "evidenceQuestion": demonstrated_in,
                "points": points,
                "status": "matched" if points == 100 else "partial" if points else "missing",
            }
        )

    fit = _clamp(sum(r["points"] for r in rows) / len(rows))
    on_resume_list = [r["skill"] for r in rows if r["onResume"]]
    evidenced = [r["skill"] for r in rows if r["demonstrated"]]
    return {
        **_empty_result(skill_source),
        "fitScore": fit,
        "requiredSkills": required,
        "skills": rows,
        "matchedSkills": [r["skill"] for r in rows if r["points"] > 0],
        "missingSkills": [r["skill"] for r in rows if r["points"] == 0],
        "onResume": on_resume_list,
        "evidencedInAnswers": evidenced,
        "resumeMatchCount": len(on_resume_list),
        "answerMatchCount": len(evidenced),
        "evidenceRule": "answer-quality",
    }


def compute_session_role_skills_fit_scored(
    ctx: dict[str, Any],
    required_skills: list[str],
    questions: list[dict[str, Any]],
    answers: list[str],
    answer_scores: list[int | None],
) -> dict[str, Any]:
    """Backward-compatible name for :func:`compute_role_skills_fit`."""
    return compute_role_skills_fit(ctx, required_skills, questions, answers, answer_scores)


def compute_session_role_skills_fit(
    ctx: dict[str, Any], required_skills: list[str], answers: list[str]
) -> dict[str, Any]:
    """Resume-only view (no interview scores yet): interview evidence counts as not demonstrated."""
    return compute_role_skills_fit(ctx, required_skills, [], [], [])
