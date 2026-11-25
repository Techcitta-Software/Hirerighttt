"""One organisation must never read another organisation's jobs, applicants, interviews or recordings.

Pure in-memory data (same shapes the API uses); these guard the multi-tenant boundary against regressions.
"""

from __future__ import annotations

import pytest

from app.services.interview_review import employer_can_review_recording, vendor_may_view_interview_session
from app.services.vendor.candidate_documents import assert_vendor_may_view_candidate_documents
from app.services.vendor.jobs import get_org_application, get_org_job, get_org_job_for_recruiter, list_org_jobs

CAND = "cand@example.com"


def _db() -> dict:
    return {
        "users": [
            {"id": "u-cand", "email": CAND, "role": "jobseeker", "status": "active"},
            {"id": "u-a1", "email": "rec-a1@a.com", "role": "employer", "status": "active"},
            {"id": "u-a2", "email": "rec-a2@a.com", "role": "employer", "status": "active"},
            {"id": "u-b1", "email": "rec-b1@b.com", "role": "employer", "status": "active"},
        ],
        "organizationMembers": [
            {"userId": "u-a1", "organizationId": "org-a", "role": "recruiter"},
            {"userId": "u-a2", "organizationId": "org-a", "role": "recruiter"},
            {"userId": "u-b1", "organizationId": "org-b", "role": "owner"},
        ],
        "jobs": [
            {"id": "job-a1", "organizationId": "org-a", "title": "A role", "createdByUserId": "u-a1", "status": "open"},
            {"id": "job-b1", "organizationId": "org-b", "title": "B role", "createdByUserId": "u-b1", "status": "open"},
        ],
        "employerApplications": [
            {"id": "app-a", "organizationId": "org-a", "jobId": "job-a1", "candidateEmail": CAND},
        ],
        "interviewSessions": {
            "sess-a": {"organizationId": "org-a", "email": CAND, "jobId": "job-a1"},
        },
    }


def test_job_lists_are_scoped_to_the_organisation():
    db = _db()
    assert [j["id"] for j in list_org_jobs(db, "org-a")] == ["job-a1"]
    assert [j["id"] for j in list_org_jobs(db, "org-b")] == ["job-b1"]
    assert list_org_jobs(db, "org-unknown") == []


def test_job_and_application_lookups_refuse_other_orgs():
    db = _db()
    assert get_org_job(db, "org-b", "job-a1") is None
    assert get_org_job(db, "org-a", "job-a1") is not None
    assert get_org_application(db, "org-b", "app-a") is None
    assert get_org_application(db, "org-a", "app-a") is not None


def test_recruiter_scope_hides_a_teammates_job():
    db = _db()
    mine = {"createdByUserId": "u-a1"}
    theirs = {"createdByUserId": "u-a2"}
    assert get_org_job_for_recruiter(db, "org-a", "job-a1", mine) is not None
    assert get_org_job_for_recruiter(db, "org-a", "job-a1", theirs) is None
    assert list_org_jobs(db, "org-a", theirs) == []


def test_candidate_video_of_a_hidden_profile_requires_a_link_to_that_organisation():
    # Owner decision: a visible job seeker is open to every employer; a hidden profile still needs a link.
    db = _db()
    assert_vendor_may_view_candidate_documents(db, "org-b", CAND, None, require_link=True)
    db["profiles"] = {CAND: {"profileVisibility": "organization_only"}}
    assert_vendor_may_view_candidate_documents(db, "org-a", CAND, None, require_link=True)  # applied to org-a
    with pytest.raises(ValueError):
        assert_vendor_may_view_candidate_documents(db, "org-b", CAND, None, require_link=True)  # never linked


def test_recruiters_cannot_be_looked_up_as_candidates():
    db = _db()
    with pytest.raises(ValueError):
        assert_vendor_may_view_candidate_documents(db, "org-a", "rec-b1@b.com", None)


def test_recording_rows_are_tenant_bound():
    db = _db()
    row = {"status": "uploaded", "tenant_id": "org-a"}
    assert employer_can_review_recording(db, "org-a", CAND, row)
    assert not employer_can_review_recording(db, "org-b", CAND, row)
    assert not employer_can_review_recording(db, "", CAND, row)
    assert not employer_can_review_recording(db, "org-a", CAND, {**row, "status": "pending"})


def test_platform_recordings_of_hidden_profiles_still_need_a_link_to_the_viewing_org():
    db = _db()
    row = {"status": "uploaded", "tenant_id": "platform"}
    assert employer_can_review_recording(db, "org-b", CAND, row)  # visible job seeker: any employer
    db["profiles"] = {CAND: {"profileVisibility": "private"}}
    assert employer_can_review_recording(db, "org-a", CAND, row)  # linked via application
    assert not employer_can_review_recording(db, "org-b", CAND, row)  # hidden and not linked to org-b


def test_interview_sessions_are_tenant_bound():
    session = _db()["interviewSessions"]["sess-a"]
    assert vendor_may_view_interview_session(session, "org-a", CAND)
    assert not vendor_may_view_interview_session(session, "org-b", CAND)
    assert not vendor_may_view_interview_session(session, "org-a", "someone-else@example.com")
