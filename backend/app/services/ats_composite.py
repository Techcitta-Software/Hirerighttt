from __future__ import annotations


def compute_employer_interview_composite(interview_overall: float, ats_overall: float) -> dict:
    interview = min(100, max(0, round(float(interview_overall or 0))))
    ats = min(100, max(0, round(float(ats_overall or 0))))
    return {
        "compositeScore": round(interview * 0.65 + ats * 0.35),
        "interviewScore": interview,
        "atsScore": ats,
    }
