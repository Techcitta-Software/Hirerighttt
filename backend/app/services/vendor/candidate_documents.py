from __future__ import annotations

from app.services.vendor.jobs import list_org_jobs


def _recruiter_emails(db: dict) -> set[str]:
    emails: set[str] = set()
    for member in db.get("organizationMembers") or []:
        if str(member.get("role") or "") not in ("owner", "admin", "recruiter"):
            continue
        user = next((u for u in db.get("users") or [] if u.get("id") == member.get("userId")), None)
        if user and user.get("email"):
            emails.add(str(user["email"]).lower())
    for user in db.get("users") or []:
        if user.get("role") == "employer" and user.get("email"):
            emails.add(str(user["email"]).lower())
    return emails


def assert_vendor_may_view_candidate_documents(
    db: dict, organization_id: str, candidate_email: str, recruiter_scope: dict | None = None
) -> None:
    email = str(candidate_email or "").strip().lower()
    if not email:
        err = ValueError("Candidate email is required.")
        err.status = 400  # type: ignore[attr-defined]
        raise err
    recruiters = _recruiter_emails(db)
    if email in recruiters:
        err = ValueError("Candidate not found.")
        err.status = 404  # type: ignore[attr-defined]
        raise err
    user = next((u for u in db.get("users") or [] if str(u.get("email", "")).lower() == email), None)
    if user and user.get("role") == "employer":
        err = ValueError("Candidate not found.")
        err.status = 404  # type: ignore[attr-defined]
        raise err
    recruiter_job_ids = None
    if recruiter_scope and recruiter_scope.get("createdByUserId"):
        recruiter_job_ids = {j["id"] for j in list_org_jobs(db, organization_id, recruiter_scope)}
    linked_app = any(
        str(a.get("organizationId") or "") == str(organization_id or "")
        and str(a.get("candidateEmail") or "").lower() == email
        and (not recruiter_job_ids or a.get("jobId") in recruiter_job_ids)
        for a in db.get("employerApplications") or []
    )
    linked_session = any(
        str(s.get("organizationId") or "") == str(organization_id or "")
        and str(s.get("email") or "").lower() == email
        and (not recruiter_job_ids or s.get("jobId") in recruiter_job_ids)
        for s in (db.get("interviewSessions") or {}).values()
    )
    job_seeker = user and user.get("role") != "employer"
    if not linked_app and not linked_session and not job_seeker:
        err = ValueError("Candidate not found.")
        err.status = 404  # type: ignore[attr-defined]
        raise err


def candidate_profile_for_documents(db: dict, candidate_email: str) -> dict:
    email = str(candidate_email or "").strip().lower()
    return dict((db.get("profiles") or {}).get(email) or {})
