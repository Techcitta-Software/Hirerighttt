from __future__ import annotations

import pytest

from app.services.interview_review import employer_can_review_recording
from app.services.vendor.candidate_documents import assert_vendor_may_view_candidate_documents as assert_view

ORG_A, ORG_B = "org-a", "org-b"
EMAIL = "asha@example.com"

DB = {
    "users": [
        {"id": "u1", "email": EMAIL, "role": "jobseeker"},
        {"id": "r1", "email": "rec-a@acme.test", "role": "employer"},
        {"id": "r2", "email": "rec-b@other.test", "role": "employer"},
    ],
    "organizationMembers": [
        {"userId": "r1", "organizationId": ORG_A, "role": "owner"},
        {"userId": "r2", "organizationId": ORG_B, "role": "owner"},
    ],
    "employerApplications": [{"organizationId": ORG_A, "candidateEmail": EMAIL, "jobId": "j1"}],
    "interviewSessions": {},
    "jobs": [],
}
ROW = {"status": "uploaded", "tenant_id": "platform", "s3_object_key": "k", "bucket": "b"}


def test_video_needs_a_real_link_to_the_organization():
    assert_view(DB, ORG_A, EMAIL, None, require_link=True)  # applied to org A: allowed
    with pytest.raises(ValueError):
        assert_view(DB, ORG_B, EMAIL, None, require_link=True)  # org B has no relationship: refused


def test_resume_and_report_keep_the_talent_search_model():
    assert_view(DB, ORG_B, EMAIL, None)  # any recruiter can still find a job seeker's profile documents


def test_recording_review_follows_the_strict_rule():
    assert employer_can_review_recording(DB, ORG_A, EMAIL, ROW) is True
    assert employer_can_review_recording(DB, ORG_B, EMAIL, ROW) is False


def test_recording_owned_by_the_organization_is_viewable_by_it():
    assert employer_can_review_recording(DB, ORG_A, EMAIL, {**ROW, "tenant_id": ORG_A}) is True
    assert employer_can_review_recording(DB, ORG_B, EMAIL, {**ROW, "tenant_id": ORG_A}) is False


def test_missing_or_unfinished_recordings_are_refused():
    assert employer_can_review_recording(DB, ORG_A, EMAIL, None) is False
    assert employer_can_review_recording(DB, ORG_A, EMAIL, {**ROW, "status": "pending"}) is False
