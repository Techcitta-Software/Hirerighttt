from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.services.vendor.ats_score import compute_ats_score


async def evaluate_resume_against_jd(
    *,
    resume_text: str,
    job_description: str,
    required_skills: list | None = None,
    role_title: str = "",
    skip_llm: bool = False,
) -> dict[str, Any]:
    baseline = compute_ats_score(
        {"resumeText": resume_text, "jobDescription": job_description, "requiredSkills": required_skills or []}
    )
    strengths: list[str] = []
    if len(baseline.get("matchedSkills") or []) >= 3:
        strengths.append(f"Strong keyword overlap: {', '.join(baseline['matchedSkills'][:5])}")
    gaps = [f"Missing required skill: {s}" for s in (baseline.get("missingSkills") or [])[:6]]
    return {
        **baseline,
        "strengths": strengths[:8],
        "gaps": gaps[:8],
        "summary": f"Resume/JD match {baseline['atsScore']}/100 with {len(baseline.get('matchedSkills') or [])} matched skills.",
        "confidence": "medium",
        "aiEnhanced": False,
        "improvementTips": [],
        "niceToHaveMissing": [],
    }


def vendor_report_needs_refresh(app_data: dict | None, force: bool = False) -> bool:
    if force:
        return True
    app_data = app_data or {}
    ir = app_data.get("interviewResult") or {}
    vr = app_data.get("vendorReport")
    if not (ir.get("answers") or []):
        return not vr
    if not vr:
        return True
    try:
        i_time = datetime.fromisoformat(str(ir.get("date") or app_data.get("evaluatedAt") or "1970").replace("Z", "+00:00")).timestamp()
        r_time = datetime.fromisoformat(str(vr.get("generatedAt") or "1970").replace("Z", "+00:00")).timestamp()
        if i_time > r_time:
            return True
    except Exception:
        pass
    if vr.get("interviewOverall") is not None and ir.get("overall") is not None and vr.get("interviewOverall") != ir.get("overall"):
        return True
    if vr.get("interviewAnswerCount") != len(ir.get("answers") or []):
        return True
    if not vr.get("interviewHighlights"):
        return True
    return False


def _grounded_report(candidate_name, job_title, company, ats_evaluation, interview_result) -> dict:
    answers = interview_result.get("answers") or [] if interview_result else []
    overall = interview_result.get("overall") if isinstance(interview_result, dict) else None
    ats = (ats_evaluation or {}).get("atsScore")
    composite = round(overall * 0.55 + ats * 0.45) if overall is not None and ats is not None else (overall or ats)
    highlights = []
    for i, a in enumerate(answers[:8]):
        q = str(a.get("question") or f"Question {i+1}")[:140]
        ans = str(a.get("answer") or "").strip()[:220]
        score = a.get("score")
        fb = str(a.get("feedback") or "").strip()
        score_bit = f"Score {score}/100. " if isinstance(score, (int, float)) else ""
        highlights.append(f"{score_bit}Q: {q} A: {ans or '(no answer)'}{(' — ' + fb[:120]) if fb else ''}")
    recommendation = "hold — complete interview or gather more evidence"
    if overall is not None:
        if overall >= 72 and (ats is None or ats >= 60):
            recommendation = "hire — strong interview with acceptable JD fit"
        elif overall >= 58:
            recommendation = "hold — mixed interview; review Q&A below"
        else:
            recommendation = "reject — interview answers below bar for this role"
    return {
        "compositeScore": composite,
        "executiveSummary": (
            f"{candidate_name} finished a {len(answers)}-question interview for {job_title} at {company}."
            if answers
            else f"{candidate_name} has not completed an interview with saved Q&A for {job_title} yet."
        ),
        "atsAnalysis": (ats_evaluation or {}).get("summary") or "",
        "skillAlignment": [],
        "interviewHighlights": highlights,
        "categoryNarratives": [],
        "risksAndGaps": [],
        "recommendation": recommendation,
        "confidence": "high" if len(answers) >= 4 else ("medium" if answers else "low"),
        "interviewAnswerCount": len(answers),
        "interviewOverall": overall,
        "resumeFitScore": interview_result.get("resumeFitScore") if interview_result else None,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


async def generate_vendor_assessment_sheet(**kwargs) -> dict:
    report = _grounded_report(
        kwargs.get("candidateName") or "Candidate",
        kwargs.get("jobTitle") or "Role",
        kwargs.get("company") or "Company",
        kwargs.get("atsEvaluation"),
        kwargs.get("interviewResult"),
    )
    return report
