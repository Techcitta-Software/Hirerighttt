from __future__ import annotations

from app.db.finders import employer_apps_for_candidate, find_user, memberships_for_user, sessions_for_email
from app.services.vendor.jobs import list_org_jobs


def _is_recruiter_account(db: dict, user: dict | None) -> bool:
    """An employer account, or a member of an organization's hiring team: never shown as a candidate."""
    if not user:
        return False
    if user.get("role") == "employer":
        return True
    return any(
        str(m.get("role") or "") in ("owner", "admin", "recruiter") for m in memberships_for_user(db, user.get("id"))
    )


def assert_vendor_may_view_candidate_documents(
    db: dict,
    organization_id: str,
    candidate_email: str,
    recruiter_scope: dict | None = None,
    *,
    require_link: bool = False,
) -> None:
    """Resumes and reports follow the talent-search model (any job seeker is visible to recruiters).

    `require_link=True` is the strict rule used for interview VIDEO: the candidate must have applied to, been invited
    by, or interviewed for this organization. Being a registered job seeker is not enough.
    """
    email = str(candidate_email or "").strip().lower()
    if not email:
        err = ValueError("Candidate email is required.")
        err.status = 400  # type: ignore[attr-defined]
        raise err
    user = find_user(db, email=email)
    if _is_recruiter_account(db, user):
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
        for a in employer_apps_for_candidate(db, email)
    )
    linked_session = any(
        str(s.get("organizationId") or "") == str(organization_id or "")
        and str(s.get("email") or "").lower() == email
        and (not recruiter_job_ids or s.get("jobId") in recruiter_job_ids)
        for s in sessions_for_email(db, email)
    )
    job_seeker = bool(user and user.get("role") != "employer") and not require_link
    if not linked_app and not linked_session and not job_seeker:
        err = ValueError("Candidate not found.")
        err.status = 404  # type: ignore[attr-defined]
        raise err


def candidate_profile_for_documents(db: dict, candidate_email: str) -> dict:
    email = str(candidate_email or "").strip().lower()
    return dict((db.get("profiles") or {}).get(email) or {})
