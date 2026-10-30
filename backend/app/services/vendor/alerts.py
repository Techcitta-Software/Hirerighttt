from __future__ import annotations

from datetime import datetime, timezone

from app.services.vendor.job_role_match import resolve_candidate_role_hints, score_job_role_alignment
from app.services.vendor.jobs import job_visible_to_recruiter

MIN_MATCH_SCORE = 50


def queue_candidate_job_alerts(db: dict, job: dict) -> list[str]:
    if not job.get("id"):
        return []
    db.setdefault("candidateJobAlerts", {})
    alerted: list[str] = []
    for user in db.get("users") or []:
        if user.get("role") == "employer" or user.get("status") == "disabled":
            continue
        email = str(user.get("email") or "").lower()
        if not email:
            continue
        profile = (db.get("profiles") or {}).get(user.get("email")) or (db.get("profiles") or {}).get(email) or {}
        hints = resolve_candidate_role_hints(profile)
        if not hints:
            continue
        if score_job_role_alignment(job, hints) < MIN_MATCH_SCORE:
            continue
        row = {
            "id": f"alert-{job['id']}-{email}",
            "jobId": job["id"],
            "title": str(job.get("title") or "New role"),
            "company": str(job.get("company") or "Employer"),
            "matchScore": score_job_role_alignment(job, hints),
            "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "read": False,
        }
        lst = db["candidateJobAlerts"].get(email) or []
        if any(a.get("jobId") == job["id"] for a in lst):
            continue
        lst.insert(0, row)
        db["candidateJobAlerts"][email] = lst[:50]
        alerted.append(email)
    return alerted


def list_candidate_job_alerts(db: dict, email: str) -> list[dict]:
    key = str(email or "").lower()
    return [a for a in (db.get("candidateJobAlerts") or {}).get(key) or [] if not a.get("read")]


def queue_employer_application_alert(db: dict, job: dict, application: dict, created: bool = True) -> dict | None:
    if not created or not job.get("organizationId") or not application.get("id"):
        return None
    db.setdefault("employerApplicationAlerts", {})
    org_id = job["organizationId"]
    lst = db["employerApplicationAlerts"].get(org_id) or []
    name = (application.get("data") or {}).get("candidateName", "").strip() or application.get("candidateEmail") or "A candidate"
    row = {
        "id": f"app-alert-{application['id']}",
        "applicationId": application["id"],
        "jobId": job.get("id"),
        "jobTitle": job.get("title"),
        "candidateName": name,
        "candidateEmail": application.get("candidateEmail"),
        "hasInterviewReport": bool((application.get("data") or {}).get("interviewResult")),
        "hasResume": bool(
            (application.get("data") or {}).get("resumeText", "").strip()
            or (application.get("data") or {}).get("resumeStoragePath")
            or (application.get("data") or {}).get("resumeFileId")
        ),
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "read": False,
    }
    if any(a.get("applicationId") == application["id"] for a in lst):
        return row
    lst.insert(0, row)
    db["employerApplicationAlerts"][org_id] = lst[:40]
    return row


def list_employer_application_alerts(db: dict, organization_id: str, options: dict | None = None) -> list[dict]:
    options = options or {}
    unread_only = options.get("unreadOnly", True) is not False
    lst = (db.get("employerApplicationAlerts") or {}).get(organization_id) or []
    if options.get("createdByUserId"):
        lst = [
            a
            for a in lst
            if job_visible_to_recruiter(
                next((j for j in db.get("jobs") or [] if j.get("id") == a.get("jobId")), {}),
                options,
            )
        ]
    return [a for a in lst if not unread_only or not a.get("read")]


def mark_employer_application_alerts_read(db: dict, organization_id: str, ids: list[str] | None) -> None:
    db.setdefault("employerApplicationAlerts", {})
    lst = db["employerApplicationAlerts"].get(organization_id) or []
    db["employerApplicationAlerts"][organization_id] = [
        {**a, "read": True} if (not ids or a.get("id") in ids) else a for a in lst
    ]
