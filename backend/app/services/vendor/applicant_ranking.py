"""Order a job's applicants by top candidature and number them.

Ranking rule (the recruiter's applicant list shows this order and the rank number):
  1. interview score (0-100, the same number as the career score), highest first; not interviewed last
  2. Role Skills Fit, highest first
  3. interview completion time, earliest first (who finished first breaks a remaining tie)
  4. application time, earliest first (stable, so the order never shuffles between page loads)

Applicants without an interview get no rank (``rank`` is None) and are listed after the ranked ones.
"""

from __future__ import annotations

from typing import Any


def _num(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def applicant_interview_score(app: dict) -> float | None:
    data = app.get("data") or {}
    result = data.get("interviewResult") if isinstance(data.get("interviewResult"), dict) else {}
    score = _num(data.get("interviewScore"))
    return score if score is not None else _num((result or {}).get("overall"))


def applicant_role_skills_fit(app: dict) -> float | None:
    data = app.get("data") or {}
    result = data.get("interviewResult") if isinstance(data.get("interviewResult"), dict) else {}
    analysis = (result or {}).get("roleSkillsAnalysis") if isinstance((result or {}).get("roleSkillsAnalysis"), dict) else {}
    if analysis and analysis.get("requiredSkills"):
        fit = _num(analysis.get("fitScore"))
        if fit is not None:
            return fit
    fit = _num((result or {}).get("resumeFitScore"))
    return fit if fit is not None else _num(data.get("resumeFitScore"))


def applicant_completed_at(app: dict) -> str:
    data = app.get("data") or {}
    result = data.get("interviewResult") if isinstance(data.get("interviewResult"), dict) else {}
    return str(data.get("evaluatedAt") or (result or {}).get("date") or "")


def _sort_key(app: dict) -> tuple:
    score = applicant_interview_score(app)
    fit = applicant_role_skills_fit(app)
    completed = applicant_completed_at(app)
    return (
        0 if score is not None else 1,
        -(score or 0),
        -(fit if fit is not None else -1),
        completed or "9999",  # ISO-8601 strings sort chronologically; missing goes last
        str(app.get("appliedAt") or "9999"),
        str(app.get("id") or ""),
    )


def rank_job_applicants(applicants: list[dict]) -> list[dict]:
    """New list, best candidate first, each a shallow copy with ``rank`` and the ranking inputs it used."""
    out: list[dict] = []
    rank = 0
    for app in sorted(applicants, key=_sort_key):
        score = applicant_interview_score(app)
        row = {
            **app,
            "rankInterviewScore": score,
            "rankRoleSkillsFit": applicant_role_skills_fit(app),
            "interviewCompletedAt": applicant_completed_at(app) or None,
        }
        if score is not None:
            rank += 1
            row["rank"] = rank
        else:
            row["rank"] = None
        out.append(row)
    return out
