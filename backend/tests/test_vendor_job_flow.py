"""Vendor job → visible to candidates → candidate applies (job board or shared link) → vendor sees the applicant.

Pure in-memory data; no database or network.
"""

from __future__ import annotations

from app.services.vendor.jobs import (
    application_source,
    create_job_application,
    create_vendor_job,
    list_job_applications,
    list_open_jobs,
    list_org_jobs,
)
from app.services.vendor.job_role_match import apply_candidate_job_scope

JD = (
    "We are hiring a Backend Engineer to build Python and PostgreSQL services. "
    "You will design REST APIs, write SQL, deploy with Docker and review code."
)


def _db() -> dict:
    return {
        "users": [
            {"id": "u-cand", "email": "cand@example.com", "role": "jobseeker", "status": "active"},
            {"id": "u-vend", "email": "vendor@example.com", "role": "employer", "status": "active"},
        ],
        "profiles": {},
        "jobs": [],
        "employerApplications": [],
    }


def _job(db: dict) -> dict:
    return create_vendor_job(
        db,
        "org-1",
        "u-vend",
        {
            "title": "Backend Engineer",
            "jobDescription": JD,
            "requiredSkills": ["Python", "PostgreSQL", "Docker", "REST APIs"],
            "company": "Acme",
            "roleTrack": "Backend Engineer",
            "experienceLevel": "3-5 Years",
            "location": "Bengaluru",
        },
    )


def test_vendor_job_is_listed_for_candidates_and_vendor() -> None:
    db = _db()
    job = _job(db)
    assert job["id"] in [j["id"] for j in list_open_jobs(db)]
    scoped = apply_candidate_job_scope(db, "cand@example.com", list_open_jobs(db), "all")
    assert job["id"] in [j["id"] for j in scoped["jobs"]]
    assert job["id"] in [j["id"] for j in list_org_jobs(db, "org-1")]


def test_applications_from_board_and_link_both_reach_the_vendor_with_scores() -> None:
    db = _db()
    job = _job(db)
    resume = "Python developer. Built REST APIs with Flask and PostgreSQL. Familiar with Git." * 2
    board = create_job_application(
        db, job, {"candidateEmail": "cand@example.com", "candidateName": "Cand", "resumeText": resume, "source": "job_board"}
    )["application"]
    link = create_job_application(
        db, job, {"candidateEmail": "outside@example.com", "candidateName": "Outside", "resumeText": resume, "source": "shared_link"}
    )["application"]

    applicants = list_job_applications(db, "org-1", job["id"])
    assert {a["id"] for a in applicants} == {board["id"], link["id"]}
    for a in applicants:
        data = a["data"]
        assert isinstance(data["atsScore"], (int, float))
        assert isinstance(data["jdMatchScore"], (int, float))
        assert "python" in [s.lower() for s in data["matchedSkills"]]
        assert "docker" in [s.lower() for s in data["missingSkills"]]
    assert {a["data"]["source"] for a in applicants} == {"job_board", "shared_link"}


def test_other_organizations_do_not_see_the_applicants() -> None:
    db = _db()
    job = _job(db)
    create_job_application(db, job, {"candidateEmail": "cand@example.com", "resumeText": "Python " * 20})
    assert list_job_applications(db, "org-2", job["id"]) == []


def test_unknown_source_values_are_not_stored() -> None:
    assert application_source("shared_link") == "shared_link"
    assert application_source("JOB_BOARD") == "job_board"
    assert application_source("<script>") is None
    assert application_source(None) is None
