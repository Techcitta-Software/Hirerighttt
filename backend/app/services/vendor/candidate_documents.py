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


HIDDEN_VISIBILITY = ("private", "organization_only")


def candidate_visible_to_employers(profile: dict | None) -> bool:
    """A job seeker's profile is visible to every employer unless they hid it ("private" / "organization_only")."""
    visibility = str((profile or {}).get("profileVisibility") or "marketplace") if isinstance(profile, dict) else "marketplace"
    return visibility not in HIDDEN_VISIBILITY


def assert_vendor_may_view_candidate_documents(
    db: dict,
    organization_id: str,
    candidate_email: str,
    recruiter_scope: dict | None = None,
    *,
    require_link: bool = False,
    contact: bool = False,
) -> None:
    """One rule for everything an employer opens about a candidate: e-mail, phone, the original resume file, the full
    interview report, the recording and the proctoring review.

    OWNER DECISION (reverses the earlier V-05 contact / report restriction): every employer-visible candidate is fully
    open to any employer - applicants of this organization's jobs AND job seekers on the Candidates list.
    Denied: hiring-team accounts, unknown e-mails, and job seekers who hid their profile (private / organization only)
    unless they applied to, were invited or interviewed by THIS organization.

    `require_link` / `contact` are accepted for older call sites; they no longer narrow the rule.
    """
    del require_link, contact
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
    if linked_app:
        return
    linked_session = any(
        str(s.get("organizationId") or "") == str(organization_id or "")
        and str(s.get("email") or "").lower() == email
        and (not recruiter_job_ids or s.get("jobId") in recruiter_job_ids)
        for s in sessions_for_email(db, email)
    )
    if linked_session:
        return
    visible_job_seeker = bool(user and user.get("role") != "employer") and candidate_visible_to_employers(
        (db.get("profiles") or {}).get(email)
    )
    if not visible_job_seeker:
        err = ValueError("Candidate not found.")
        err.status = 404  # type: ignore[attr-defined]
        raise err


def candidate_profile_for_documents(db: dict, candidate_email: str) -> dict:
    email = str(candidate_email or "").strip().lower()
    return dict((db.get("profiles") or {}).get(email) or {})


def assert_vendor_may_open_stored_resume(
    db: dict,
    organization_id: str,
    user_id: str,
    recruiter_scope: dict | None = None,
) -> dict:
    """The original resume file for someone on the Candidates list (by user id). Same rule as every other candidate
    document: any employer, unless the candidate hid their profile and has no link to this organization.
    Returns the user."""
    uid = str(user_id or "").strip()
    if not uid:
        err = ValueError("Candidate is required.")
        err.status = 400  # type: ignore[attr-defined]
        raise err
    user = find_user(db, user_id=uid)
    if not user or _is_recruiter_account(db, user) or str(user.get("role") or "") == "employer":
        err = ValueError("Candidate not found.")
        err.status = 404  # type: ignore[attr-defined]
        raise err
    email = str(user.get("email") or "").strip().lower()
    assert_vendor_may_view_candidate_documents(db, organization_id, email, recruiter_scope)
    return user


# --------------------------------------------------------------------------------------------------------------
# Roster / talent-search rows. OWNER DECISION: e-mail, phone, resume and the full interview report are shown for
# every employer-visible candidate. What stays out: candidates who hid their profile and have no link to this
# organization (they are dropped from the rows, not redacted).

LINKED_ROSTER_SOURCES = frozenset({"application", "vault", "interview", "interview_report"})


def candidate_shares_contact(profile: dict | None) -> bool:
    """Kept for older callers: an explicit opt-in flag on the profile. No longer needed to see contact details."""
    return bool(isinstance(profile, dict) and profile.get("shareContactWithRecruiters") is True)


def redact_roster_rows(db: dict, rows: list[dict]) -> list[dict]:
    """Blocking (profile lookups). Rows linked to the organization are returned unchanged. Platform / talent rows
    of candidates who hid their profile are dropped; every other row is returned in full (contactHidden False)."""
    unlinked = [r for r in rows if str(r.get("source") or "") not in LINKED_ROSTER_SOURCES]
    profiles = profiles_for_emails(db, [r.get("candidateEmail") for r in unlinked]) if unlinked else {}
    out = []
    for r in rows:
        if str(r.get("source") or "") in LINKED_ROSTER_SOURCES:
            out.append({**r, "contactHidden": False})
            continue
        email = str(r.get("candidateEmail") or "").lower()
        if not candidate_visible_to_employers(profiles.get(email)):
            continue
        out.append({**r, "contactHidden": False})
    return out


def redact_talent_hits(db: dict, organization_id: str, hits: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Talent-search results. The talent index already leaves out hidden profiles (see talent_index.py); every hit
    keeps its e-mail and resume preview."""
    del db, organization_id
    return [{**h, "contactHidden": False} for h in hits or []]
