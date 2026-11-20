from __future__ import annotations

from typing import Any

from app.db.finders import (
    employer_apps_for_candidate,
    find_user,
    memberships_for_user,
    profiles_for_emails,
    sessions_for_email,
)
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
    contact: bool = False,
) -> None:
    """Interview reports follow the talent-search model (any job seeker is visible to recruiters).

    `require_link=True` is the strict rule used for interview VIDEO: the candidate must have applied to, been invited
    by, or interviewed for this organization. Being a registered job seeker is not enough.
    `contact=True` is the rule for CONTACT data (resume file, e-mail, phone; V-05): a link to this organization as
    above, or the candidate opted in (profile.shareContactWithRecruiters).
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
    if contact:
        job_seeker = bool(user and user.get("role") != "employer") and candidate_shares_contact(
            (db.get("profiles") or {}).get(email)
        )
    if not linked_app and not linked_session and not job_seeker:
        err = ValueError("Candidate not found.")
        err.status = 404  # type: ignore[attr-defined]
        raise err


def candidate_profile_for_documents(db: dict, candidate_email: str) -> dict:
    email = str(candidate_email or "").strip().lower()
    return dict((db.get("profiles") or {}).get(email) or {})


# --------------------------------------------------------------------------------------------------------------
# V-05: contact data (e-mail, phone, resume) of candidates who have no link to the employer.
#
# Any self-registered employer can browse the platform roster and the talent search. Discovery stays (name, role,
# skills, experience, interview score), but contact details and the resume are only shown when the candidate applied
# to / was invited or interviewed by THIS organization, or opted in with profile.shareContactWithRecruiters = true.
# (Product decision for the owner: there is no opt-in toggle in the UI yet, so today unlinked candidates are hidden.)

LINKED_ROSTER_SOURCES = frozenset({"application", "vault", "interview", "interview_report"})


def candidate_shares_contact(profile: dict | None) -> bool:
    return bool(isinstance(profile, dict) and profile.get("shareContactWithRecruiters") is True)


def hide_roster_contact(row: dict) -> dict:
    out = {**row, "candidateEmail": "", "candidatePhone": "", "resumeText": "", "resumeName": None, "contactHidden": True}
    out.pop("resumeTextTruncated", None)
    out.pop("resumeTextLength", None)
    return out


def redact_roster_rows(db: dict, rows: list[dict]) -> list[dict]:
    """Blocking (profile lookups). Rows from the platform roster / talent search lose their contact fields unless the
    candidate opted in. Rows linked to the organization are returned unchanged."""
    unlinked = [r for r in rows if str(r.get("source") or "") not in LINKED_ROSTER_SOURCES]
    profiles = profiles_for_emails(db, [r.get("candidateEmail") for r in unlinked]) if unlinked else {}
    out = []
    for r in rows:
        if str(r.get("source") or "") in LINKED_ROSTER_SOURCES:
            out.append(r)
            continue
        email = str(r.get("candidateEmail") or "").lower()
        out.append(r if candidate_shares_contact(profiles.get(email)) else hide_roster_contact(r))
    return out


def _org_access_user_ids(db: dict, organization_id: str, user_ids: list) -> set[str]:
    from app.db.uow import UnitOfWork

    ids = sorted({str(u) for u in user_ids if u})
    if not ids or not isinstance(db, UnitOfWork):
        return set()
    try:
        rows = db.query(
            "SELECT user_id FROM organization_talent_access WHERE organization_id = %s AND user_id = ANY(%s)",
            (organization_id, ids),
        )
        return {str(r["user_id"]) for r in rows}
    except Exception:
        return set()


def redact_talent_hits(db: dict, organization_id: str, hits: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Blocking. Talent-search results: e-mail and resume text only for candidates with access granted to this
    organization (application / interview) or who opted in."""
    if not hits:
        return hits
    granted = _org_access_user_ids(db, organization_id, [h.get("userId") for h in hits])
    profiles = profiles_for_emails(db, [h.get("email") for h in hits if str(h.get("userId")) not in granted])
    out = []
    for h in hits:
        email = str(h.get("email") or "").lower()
        if str(h.get("userId")) in granted or candidate_shares_contact(profiles.get(email)):
            out.append(h)
            continue
        hidden = {**h, "email": "", "contactHidden": True}
        for key in ("resumePreview", "resumeSnippet"):
            if key in hidden:
                hidden[key] = ""
        out.append(hidden)
    return out
