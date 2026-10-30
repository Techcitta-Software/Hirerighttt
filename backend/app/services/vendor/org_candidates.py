from __future__ import annotations

from typing import Any

from app.services.vendor.jobs import list_job_applications, list_org_jobs


def _status_from_app(app: dict) -> str:
    st = str(app.get("status") or "applied").lower()
    if st == "interviewed":
        return "In Review"
    if st == "shortlisted":
        return "Interview"
    return "New"


def _record_from_application(app: dict) -> dict:
    data = app.get("data") or {}
    return {
        "id": app.get("id"),
        "source": "application",
        "organizationId": app.get("organizationId"),
        "jobId": app.get("jobId"),
        "candidateUserId": app.get("candidateUserId"),
        "candidateEmail": app.get("candidateEmail"),
        "candidateName": data.get("candidateName") or app.get("candidateEmail"),
        "candidatePhone": data.get("candidatePhone") or "",
        "candidateRole": data.get("roleTrack") or data.get("jobTitle") or "",
        "experienceYears": data.get("experienceYears") or "",
        "jobTitle": data.get("jobTitle") or "",
        "company": data.get("company") or "",
        "resumeName": data.get("resumeName"),
        "resumeText": data.get("resumeText") or "",
        "interviewResult": data.get("interviewResult"),
        "atsScore": data.get("atsScore"),
        "jdMatchScore": data.get("jdMatchScore"),
        "primarySkills": data.get("primarySkills") or [],
        "appliedAt": app.get("appliedAt"),
        "status": _status_from_app(app),
    }


def _matches_filters(row: dict, filters: dict) -> bool:
    name = str(filters.get("name") or "").lower()
    if name and name not in str(row.get("candidateName") or "").lower():
        return False
    job_q = str(filters.get("job") or "").lower()
    if job_q and job_q not in str(row.get("jobTitle") or "").lower():
        return False
    exp = str(filters.get("experienceYears") or "").lower()
    if exp and exp not in str(row.get("experienceYears") or "").lower():
        return False
    keywords = str(filters.get("keywords") or "").lower()
    if keywords:
        blob = " ".join(
            [
                str(row.get("candidateName") or ""),
                str(row.get("resumeText") or "")[:2000],
                " ".join(row.get("primarySkills") or []),
            ]
        ).lower()
        if keywords not in blob:
            return False
    return True


def list_job_candidates(db: dict, organization_id: str, job_id: str, filters: dict | None = None) -> dict[str, Any]:
    filters = filters or {}
    apps = list_job_applications(db, organization_id, job_id)
    candidates = [_record_from_application(a) for a in apps]
    by_email: dict[str, dict] = {}
    for row in candidates:
        key = str(row.get("candidateEmail") or "").lower()
        by_email[key] = row
    filtered = [r for r in by_email.values() if _matches_filters(r, {**filters, "jobId": job_id})]
    return {"total": len(filtered), "candidates": filtered, "jobId": job_id}


async def list_organization_candidates(
    db: dict,
    organization_id: str,
    database_url: str,
    filters: dict | None = None,
    recruiter_scope: dict | None = None,
) -> dict[str, Any]:
    filters = filters or {}
    recruiter_job_ids = None
    if recruiter_scope and recruiter_scope.get("createdByUserId"):
        recruiter_job_ids = {j["id"] for j in list_org_jobs(db, organization_id, recruiter_scope)}
    by_key: dict[str, dict] = {}
    for app in db.get("employerApplications") or []:
        if app.get("organizationId") != organization_id:
            continue
        if recruiter_job_ids and app.get("jobId") not in recruiter_job_ids:
            continue
        row = _record_from_application(app)
        key = row.get("candidateUserId") or str(row.get("candidateEmail") or "").lower()
        by_key[key] = row
    candidates = [r for r in by_key.values() if _matches_filters(r, filters)]
    return {"total": len(candidates), "candidates": candidates}
