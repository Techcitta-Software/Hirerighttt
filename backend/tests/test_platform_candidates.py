"""The employer Candidates page (GET /api/vendor/candidates?scope=platform): every visible job seeker, one row each.

Privacy rules kept: hidden profiles are not listed (unless linked to this organisation), recruiters never listed, other
organisations' applications isolated. OWNER DECISION (reverses V-05): every listed candidate shows e-mail, phone,
resume and the full interview report to any employer.
"""

from __future__ import annotations

import asyncio
import os

import pytest

from app.services.vendor.candidate_documents import assert_vendor_may_open_stored_resume
from app.services.vendor.org_candidates import list_organization_candidates
from app.services.vendor.platform_candidates import (
    list_platform_candidates,
    normalize_platform_filters,
    scrub_contact_details,
)

RESUME = """Ganesh Paidi
Backend Engineer | ganesh.p@example.com | +91 98765 43210 | linkedin.com/in/ganesh
Bengaluru, India

Summary
Backend engineer with 5 years of Python and payments experience.

Experience
Senior Engineer, Acme Pay (2021 - Present)
- Built FastAPI services.

Skills: Python, FastAPI, PostgreSQL
"""

REPORT = {
    "overall": 72,
    "role": "Backend Engineer",
    "answers": [{"question": "Q?", "answer": "private answer"}],
    "integrity": {"logs": [{"eventType": "NO_FACE_SEEN"}]},
    "sessionId": "sess-g",
}


def _db():
    return {
        "users": [
            {"id": "u-g", "email": "ganesh.p@example.com", "name": "Ganesh Paidi", "role": "jobseeker", "phone": "+919876543210",
             "createdAt": "2026-11-01T00:00:00Z"},
            {"id": "u-a", "email": "anita@example.com", "name": "Anita Rao", "role": "jobseeker", "createdAt": "2026-11-02T00:00:00Z"},
            {"id": "u-p", "email": "private@example.com", "name": "Priv Person", "role": "jobseeker", "createdAt": "2026-11-03T00:00:00Z"},
            {"id": "u-o", "email": "optin@example.com", "name": "Opt In", "role": "jobseeker", "createdAt": "2026-11-04T00:00:00Z"},
            {"id": "u-r", "email": "rec@acme.test", "name": "Rita Recruiter", "role": "jobseeker"},
            {"id": "u-e", "email": "boss@acme.test", "name": "Boss", "role": "employer"},
        ],
        "profiles": {
            "ganesh.p@example.com": {"resumeText": RESUME, "currentRole": "Backend Engineer", "totalExperience": "5 years",
                                     "currentLocation": "Bengaluru", "skills": ["Python", "FastAPI"], "resumeName": "g.pdf"},
            "anita@example.com": {"resumeText": "Anita Rao\nFrontend Developer | anita@example.com\nSkills: React", "totalExperience": "2"},
            "private@example.com": {"resumeText": "Priv Person\nSecret", "profileVisibility": "private"},
            "optin@example.com": {"resumeText": "Opt In\nData analyst | optin@example.com", "shareContactWithRecruiters": True},
        },
        "interviews": {"ganesh.p@example.com": REPORT},
        "employerApplications": [
            # Saved without candidateUserId (older rows): the same person must still be one row.
            {"id": "app-1", "organizationId": "org-a", "jobId": "job-a", "candidateEmail": "ganesh.p@example.com",
             "status": "shortlisted", "appliedAt": "2026-11-10T00:00:00Z",
             "data": {"jobTitle": "Backend Engineer", "resumeText": RESUME, "interviewResult": {"overall": 61}}},
        ],
        "jobs": [{"id": "job-a", "organizationId": "org-a", "title": "Backend Engineer", "status": "published"}],
        "interviewSessions": {},
        "organizationMembers": [{"userId": "u-r", "organizationId": "org-a", "role": "recruiter"}],
        "confidentialVault": [],
    }


def _list(db, org, **params):
    return asyncio.run(list_platform_candidates(db, org, "", params))


def _by_email(page):
    return {c["candidateName"]: c for c in page["candidates"]}


def test_lists_every_visible_job_seeker_not_only_applicants():
    page = _list(_db(), "org-a")
    names = sorted(c["candidateName"] for c in page["candidates"])
    assert names == ["Anita Rao", "Ganesh Paidi", "Opt In"]  # private profile, recruiter and employer left out
    assert page["total"] == 3 and page["stats"]["total"] == 3
    assert page["stats"]["interviewed"] == 1 and page["stats"]["averageScore"] == 72


def test_one_row_per_person_with_their_applications():
    page = _list(_db(), "org-a")
    ganesh = [c for c in page["candidates"] if c["candidateName"] == "Ganesh Paidi"]
    assert len(ganesh) == 1
    row = ganesh[0]
    assert row["id"] == "talent-u-g"
    assert [a["jobId"] for a in row["applications"]] == ["job-a"]
    assert row["source"] == "application" and row["contactHidden"] is False
    assert row["candidateEmail"] == "ganesh.p@example.com" and row["candidatePhone"]
    assert row["interviewResult"]["answers"][0]["answer"] == "private answer"  # applied here: full report


def test_unrelated_org_sees_contact_resume_and_full_report():
    page = _list(_db(), "org-b")
    row = _by_email(page)["Ganesh Paidi"]
    assert row["contactHidden"] is False
    assert row["candidateEmail"] == "ganesh.p@example.com" and row["candidatePhone"] == "+919876543210"
    assert "FastAPI services" in row["resumeText"] and row["resumeName"] == "g.pdf"
    assert row["interviewResult"]["overall"] == 72
    assert row["interviewResult"]["answers"][0]["answer"] == "private answer"
    assert row["interviewResult"]["sessionId"] == "sess-g" and "integrity" in row["interviewResult"]
    assert not row.get("applications")  # org A's application is still not shown to org B


def test_candidate_without_opt_in_also_shows_contact_to_any_org():
    row = _by_email(_list(_db(), "org-b"))["Anita Rao"]
    assert row["contactHidden"] is False and row["candidateEmail"] == "anita@example.com"


def test_opted_in_candidate_shows_contact_to_any_org():
    row = _by_email(_list(_db(), "org-b"))["Opt In"]
    assert row["contactHidden"] is False and row["candidateEmail"] == "optin@example.com"


def test_private_profile_is_listed_only_for_an_org_it_applied_to():
    db = _db()
    db["employerApplications"].append(
        {"id": "app-2", "organizationId": "org-b", "jobId": "job-b", "candidateEmail": "private@example.com",
         "status": "applied", "appliedAt": "2026-11-11T00:00:00Z", "data": {"jobTitle": "Job B"}}
    )
    assert "Priv Person" in _by_email(_list(db, "org-b"))
    assert "Priv Person" not in _by_email(_list(db, "org-a"))


def test_filters_search_and_pagination_run_on_the_server():
    db = _db()
    assert [c["candidateName"] for c in _list(db, "org-b", q="fastapi")["candidates"]] == ["Ganesh Paidi"]
    assert _list(db, "org-b", interviewed="yes")["total"] == 1
    assert _list(db, "org-b", interviewed="no")["total"] == 2
    assert _list(db, "org-b", minScore="80")["total"] == 0
    assert _list(db, "org-b", expMin="4")["total"] == 1
    assert _list(db, "org-b", location="bengaluru")["total"] == 1
    assert [c["candidateName"] for c in _list(db, "org-a", linked="1")["candidates"]] == ["Ganesh Paidi"]
    first = _list(db, "org-b", limit="2", offset="0")
    second = _list(db, "org-b", limit="2", offset="2")
    assert first["total"] == 3 and len(first["candidates"]) == 2 and len(second["candidates"]) == 1
    assert not {c["id"] for c in first["candidates"]} & {c["id"] for c in second["candidates"]}
    # Stats describe the whole visible list, not the filtered page.
    assert _list(db, "org-b", q="nobody-matches")["stats"]["total"] == 3


def test_searching_an_email_or_phone_does_not_reveal_hidden_contact_details():
    db = _db()
    assert _list(db, "org-b", q="ganesh.p@example.com")["total"] == 0
    assert _list(db, "org-b", q="9876543210")["total"] == 0
    assert _list(db, "org-b", q="98765")["total"] == 0


def test_filter_values_are_clamped():
    f = normalize_platform_filters({"limit": "-5", "offset": "x", "minScore": "500", "expMin": "abc", "sort": "drop table"})
    assert f["limit"] == 1 and f["offset"] == 0 and f["minScore"] is None and f["expMin"] is None and f["sort"] == "recent"
    assert normalize_platform_filters({"limit": "9999"})["limit"] == 50


def test_scrub_contact_details_keeps_dates_and_content():
    text = "Jane Doe\nEngineer | jane@x.io | +1 (415) 555-0100 | https://github.com/jane\nPhone: 98450 12345\n2019 - 2021 at Foo, PIN 560001"
    out = scrub_contact_details(text)
    assert out.splitlines()[0] == "Jane Doe" and out.splitlines()[1] == "Engineer"
    assert "jane@x.io" not in out and "555" not in out and "github" not in out and "98450" not in out
    assert "2019 - 2021 at Foo, PIN 560001" in out


def test_stored_resume_opens_for_a_visible_candidate_and_not_a_private_one():
    db = _db()
    db["profiles"]["anita@example.com"]["resumeStoragePath"] = "users/u-a/resume/resume.pdf"
    page = _list(db, "org-b")
    anita = _by_email(page)["Anita Rao"]
    assert anita["contactHidden"] is False and anita["candidateEmail"] == "anita@example.com"
    assert anita["hasResumeFile"] is True and anita["candidateUserId"] == "u-a"
    opened = assert_vendor_may_open_stored_resume(db, "org-b", "u-a")
    assert opened["id"] == "u-a"
    with pytest.raises(ValueError):
        assert_vendor_may_open_stored_resume(db, "org-b", "u-p")
    with pytest.raises(ValueError):
        assert_vendor_may_open_stored_resume(db, "org-b", "u-r")


def test_org_roster_is_one_row_per_email_even_without_user_id():
    """The Applicants list (scope=org) showed the same person twice: application keyed by e-mail, the talent /
    interview record keyed by user id, with different scores."""
    db = _db()
    db["interviewSessions"] = {
        "s1": {"email": "ganesh.p@example.com", "organizationId": "org-a", "result": {"overall": 72}, "jobId": "job-a",
               "applicationId": None}
    }
    roster = asyncio.run(list_organization_candidates(db, "org-a", "", {"scope": "org"}))
    rows = [c for c in roster["candidates"] if c["candidateEmail"] == "ganesh.p@example.com"]
    assert len(rows) == 1


# ── Same rules through the real route and Postgres ─────────────────────────────────────────────────────────


needs_db = pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not set")


@needs_db
def test_platform_route_on_postgres(client):
    from tests.test_qa_e2e_db import RESUME as QA_RESUME, _apply, _job_body, _signup

    a = _signup(client, role="employer", name="Rita Recruiter", company="Acme Platform QA")
    b = _signup(client, role="employer", name="Bob Boss", company="Other Platform QA")
    job = client.post("/api/vendor/jobs", json=_job_body(), headers=a["h"]).json()["job"]
    applied = _signup(client, name="Applied Person")
    other = _signup(client, name="Other Person")
    hidden = _signup(client, name="Hidden Person")
    client.put("/api/profile", json={"resumeText": QA_RESUME, "currentRole": "Backend Engineer"}, headers=applied["h"])
    client.put("/api/profile", json={"resumeText": "Other Person\nData analyst | other@x.test\nSkills: SQL"}, headers=other["h"])
    client.put("/api/profile", json={"resumeText": "Hidden Person\nSecret", "profileVisibility": "private"}, headers=hidden["h"])
    _apply(client, {"job": job, "cand": applied}, applied)

    def page(h, **q):
        qs = "&".join(f"{k}={v}" for k, v in {"scope": "platform", "limit": 50, **q}.items())
        res = client.get(f"/api/vendor/candidates?{qs}", headers=h)
        assert res.status_code == 200, res.text
        return res.json()

    mine = page(a["h"])
    emails = [c["candidateEmail"] for c in mine["candidates"]]
    ids = [c["id"] for c in mine["candidates"]]
    assert len(ids) == len(set(ids))
    assert applied["email"] in emails  # applied: contact shown
    assert hidden["email"] not in emails and all(c["candidateName"] != "Hidden Person" for c in mine["candidates"])
    assert a["email"] not in emails and b["email"] not in emails  # recruiters never listed
    other_row = next(c for c in mine["candidates"] if c["candidateName"] == "Other Person")
    assert other_row["contactHidden"] is False and other_row["candidateEmail"] == other["email"]  # owner decision
    assert "SQL" in other_row["resumeText"]

    theirs = page(b["h"])
    applied_row = next(c for c in theirs["candidates"] if c["candidateName"] == "Priya Natarajan")
    assert applied_row["contactHidden"] is False and applied_row["candidateEmail"] == applied["email"]
    assert not applied_row.get("applications")  # org A's application is not shown to org B

    assert page(a["h"], q="kafka")["total"] >= 1
    assert client.get("/api/vendor/candidates?scope=platform", headers=applied["h"]).status_code == 403
