from __future__ import annotations

from datetime import datetime, timezone

from app.db.finders import find_job, find_users_by_emails, profiles_for_emails
from app.services.vendor.job_role_match import resolve_candidate_role_hints, score_job_role_alignment
from app.services.vendor.jobs import job_visible_to_recruiter

MIN_MATCH_SCORE = 50
MAX_ALERT_CANDIDATES = 2000  # per job post; the full-text index picks the most relevant candidates first


def _alert_candidates(db: dict, job: dict) -> list[dict]:
    """Candidates worth scoring for this job. Postgres: a full-text query over the talent index, never every user."""
    from app.db.uow import UnitOfWork

    if not isinstance(db, UnitOfWork):
        return [u for u in db.get("users") or []]
    terms = " ".join(str(job.get(k) or "") for k in ("title", "roleTrack")).strip()
    if not terms:
        return []
    rows = db.query(
        """SELECT email FROM candidate_talent_profiles
           WHERE search_vector @@ plainto_tsquery('english', %s)
           ORDER BY ts_rank(search_vector, plainto_tsquery('english', %s)) DESC
           LIMIT %s""",
        (terms, terms, MAX_ALERT_CANDIDATES),
    )
    emails = [r["email"] for r in rows]
    profiles_for_emails(db, emails)  # one query for all of their profiles
    return list(find_users_by_emails(db, emails).values())


def queue_candidate_job_alerts(db: dict, job: dict) -> list[str]:
    if not job.get("id"):
        return []
    db.setdefault("candidateJobAlerts", {})
    alerted: list[str] = []
    for user in _alert_candidates(db, job):
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
            if job_visible_to_recruiter(find_job(db, a.get("jobId")) or {}, options)
        ]
    return [a for a in lst if not unread_only or not a.get("read")]


def mark_employer_application_alerts_read(db: dict, organization_id: str, ids: list[str] | None) -> None:
    db.setdefault("employerApplicationAlerts", {})
    lst = db["employerApplicationAlerts"].get(organization_id) or []
    db["employerApplicationAlerts"][organization_id] = [
        {**a, "read": True} if (not ids or a.get("id") in ids) else a for a in lst
    ]
