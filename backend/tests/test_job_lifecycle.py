"""Job lifecycle: edit a job, unpublish / publish, close / reopen, archive (PATCH /api/vendor/jobs/{id}).

Unit tests run in memory; the route tests need a throwaway Postgres (TEST_DATABASE_URL) and skip without one.
"""

from __future__ import annotations

import os
import secrets

import pytest

from tests.test_qa_e2e_db import fake_llm  # noqa: F401  (fixture used by name)
from app.services.vendor.jobs import (
    JOB_CLOSED_MESSAGE,
    create_job_application,
    create_vendor_job,
    find_job_by_code_any_status,
    get_job_by_shareable_code,
    job_status,
    list_job_applications,
    list_open_jobs,
    list_org_jobs,
    update_vendor_job,
)

JD = (
    "We are hiring a Backend Engineer to build Python and PostgreSQL services. "
    "You will design REST APIs, write SQL, deploy with Docker and review code."
)


def _db() -> dict:
    return {
        "users": [{"id": "u-vend", "email": "vendor@example.com", "role": "employer", "status": "active"}],
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
            "requiredSkills": ["Python", "PostgreSQL"],
            "company": "Acme",
            "roleTrack": "Backend Engineer",
            "experienceLevel": "3-5 Years",
            "location": "Bengaluru",
        },
    )


# ── unit: update_vendor_job ──────────────────────────────────────────────────────────────────────────────────


def test_edit_fields_and_skills_are_normalised() -> None:
    db = _db()
    job = _job(db)
    out = update_vendor_job(
        job,
        {"title": "  Senior Backend Engineer ", "requiredSkills": "Python, Kafka, Python, ", "location": "Remote"},
    )
    assert job["title"] == "Senior Backend Engineer"
    assert job["requiredSkills"] == ["Python", "Kafka"]
    assert job["location"] == "Remote"
    assert set(out["changed"]) == {"title", "requiredSkills", "location"}
    assert job.get("updatedAt")


def test_unchanged_values_report_no_change() -> None:
    db = _db()
    job = _job(db)
    assert update_vendor_job(job, {"title": "Backend Engineer"})["changed"] == []


@pytest.mark.parametrize(
    "body,status",
    [
        ({}, 400),
        ({"title": ""}, 400),
        ({"title": "x" * 201}, 400),
        ({"jobDescription": "too short"}, 400),
        ({"requiredSkills": []}, 400),
        ({"requiredSkills": [f"s{i}" for i in range(41)]}, 400),
        ({"requiredSkills": [1, 2]}, 400),
        ({"status": "deleted"}, 400),
        ({"organizationId": "org-2"}, 400),  # tenant / owner fields are never editable
        ({"shareableCode": "abc"}, 400),
    ],
)
def test_invalid_edits_are_rejected(body: dict, status: int) -> None:
    db = _db()
    job = _job(db)
    before = dict(job)
    with pytest.raises(ValueError) as exc:
        update_vendor_job(job, body)
    assert getattr(exc.value, "status", None) == status
    assert job == before  # nothing half-applied


def test_status_transitions() -> None:
    db = _db()
    job = _job(db)
    assert job_status(job) == "published"  # legacy "active"
    assert update_vendor_job(job, {"status": "closed"}) == {"changed": ["status"], "from": "published", "to": "closed"}
    # closed -> draft is not a move the UI offers
    with pytest.raises(ValueError) as exc:
        update_vendor_job(job, {"status": "draft"})
    assert getattr(exc.value, "status", None) == 409
    update_vendor_job(job, {"status": "published"})  # reopen
    update_vendor_job(job, {"status": "draft"})  # unpublish
    update_vendor_job(job, {"status": "published"})
    update_vendor_job(job, {"status": "archived"})
    with pytest.raises(ValueError):
        update_vendor_job(job, {"status": "published"})
    update_vendor_job(job, {"status": "closed"})  # restore from the archive comes back closed
    assert job["status"] == "closed"


def test_closed_and_draft_jobs_leave_the_board_and_the_link_but_keep_applicants() -> None:
    db = _db()
    job = _job(db)
    resume = "Python developer. Built REST APIs with Flask and PostgreSQL. Familiar with Git." * 2
    create_job_application(db, job, {"candidateEmail": "cand@example.com", "resumeText": resume})
    for status in ("closed", "draft"):
        job["status"] = "published"
        update_vendor_job(job, {"status": status})
        assert job["id"] not in [j["id"] for j in list_open_jobs(db)]
        assert get_job_by_shareable_code(db, job["shareableCode"]) is None
        # the share link still knows the job, so it can say "closed" instead of "not found"
        assert find_job_by_code_any_status(db, job["shareableCode"])["id"] == job["id"]
        # the organisation still sees the job and its applicants
        assert job["id"] in [j["id"] for j in list_org_jobs(db, "org-1")]
        assert len(list_job_applications(db, "org-1", job["id"])) == 1
    update_vendor_job(job, {"status": "published"})
    assert job["id"] in [j["id"] for j in list_open_jobs(db)]
    update_vendor_job(job, {"status": "archived"})
    assert job["id"] not in [j["id"] for j in list_org_jobs(db, "org-1")]
    assert len(list_job_applications(db, "org-1", job["id"])) == 1


# ── routes (real throwaway Postgres) ─────────────────────────────────────────────────────────────────────────

needs_db = pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not set")


@pytest.fixture
def lifecycle_world(client):
    from tests.test_qa_e2e_db import _job_body, _signup

    org_a = _signup(client, role="employer", name="Rita Recruiter", company=f"Acme {secrets.token_hex(3)}")
    org_b = _signup(client, role="employer", name="Bob Boss", company=f"Other {secrets.token_hex(3)}")
    res = client.post("/api/vendor/jobs", json=_job_body(), headers=org_a["h"])
    assert res.status_code == 201, res.text
    cand = _signup(client, name="Cand")
    return {"a": org_a, "b": org_b, "job": res.json()["job"], "cand": cand}


@pytest.fixture(autouse=True)
def _fresh_limits():
    from app.server import ratelimit

    ratelimit.reset_for_tests()
    yield
    ratelimit.reset_for_tests()


def _set_member_role(email: str, role: str) -> None:
    from app.db import store

    with store.db_pool(os.environ["TEST_DATABASE_URL"]).connection() as conn:
        conn.execute(
            "UPDATE organization_members SET role = %s WHERE user_id = (SELECT id FROM users WHERE lower(email) = %s)",
            (role, email.lower()),
        )
        conn.commit()


@needs_db
def test_patch_job_auth_isolation_and_roles(client, lifecycle_world):
    w = lifecycle_world
    url = f"/api/vendor/jobs/{w['job']['id']}"
    assert client.patch(url, json={"status": "closed"}).status_code == 401
    assert client.patch(url, json={"status": "closed"}, headers=w["cand"]["h"]).status_code == 403
    # another organisation: 404, and the job is untouched
    assert client.patch(url, json={"status": "closed"}, headers=w["b"]["h"]).status_code == 404
    assert client.patch("/api/vendor/jobs/nope", json={"status": "closed"}, headers=w["a"]["h"]).status_code == 404
    jobs = client.get("/api/vendor/jobs", headers=w["a"]["h"]).json()["jobs"]
    assert [j["status"] for j in jobs if j["id"] == w["job"]["id"]] == ["published"]
    # a member who is not a recruiter / admin / owner (read-only seat) cannot change jobs
    viewer = w["b"]
    _set_member_role(viewer["email"], "viewer")
    assert client.patch(url, json={"status": "closed"}, headers=viewer["h"]).status_code == 403


@needs_db
def test_patch_job_validation(client, lifecycle_world):
    w = lifecycle_world
    url = f"/api/vendor/jobs/{w['job']['id']}"
    h = w["a"]["h"]
    assert client.patch(url, json={}, headers=h).status_code == 400
    assert client.patch(url, json={"jobDescription": "short"}, headers=h).status_code == 400
    assert client.patch(url, json={"organizationId": "x"}, headers=h).status_code == 400
    r = client.patch(url, content="[1]", headers={**h, "Content-Type": "application/json"})
    assert r.status_code == 400
    client.patch(url, json={"status": "closed"}, headers=h)
    assert client.patch(url, json={"status": "draft"}, headers=h).status_code == 409


@needs_db
def test_close_reopen_effects_and_audit(client, lifecycle_world):
    from tests.test_qa_e2e_db import RESUME

    w = lifecycle_world
    job, h = w["job"], w["a"]["h"]
    code = job["shareableCode"]
    applied = client.post(f"/api/jobs/public/{code}/apply", json={"resumeText": RESUME}, headers=w["cand"]["h"])
    assert applied.status_code in (200, 201), applied.text

    closed = client.patch(f"/api/vendor/jobs/{job['id']}", json={"status": "closed"}, headers=h)
    assert closed.status_code == 200, closed.text
    assert closed.json()["job"]["status"] == "closed" and closed.json()["changed"] == ["status"]
    assert closed.json()["job"]["applicantCount"] == 1

    # gone from the public board, and the share / apply link says it is closed
    board = client.get("/api/jobs?scope=all", headers=w["cand"]["h"]).json()["jobs"]
    assert job["id"] not in [j["id"] for j in board]
    board_summary = client.get("/api/jobs?scope=all&summary=1", headers=w["cand"]["h"]).json()["jobs"]
    assert job["id"] not in [j["id"] for j in board_summary]
    link = client.get(f"/api/jobs/public/{code}")
    assert link.status_code == 410 and link.json()["code"] == "JOB_CLOSED"
    assert link.json()["error"] == JOB_CLOSED_MESSAGE and link.json()["job"]["title"] == job["title"]
    other = _signup_cand(client)
    late = client.post(f"/api/jobs/public/{code}/apply", json={"resumeText": RESUME}, headers=other["h"])
    assert late.status_code == 410
    assert client.get("/api/jobs/public/doesnotexist").status_code == 404

    # the organisation still sees the job and its applicant
    jobs = client.get("/api/vendor/jobs", headers=h).json()["jobs"]
    assert [j["status"] for j in jobs if j["id"] == job["id"]] == ["closed"]
    applicants = client.get(f"/api/vendor/jobs/{job['id']}/applicants", headers=h)
    assert applicants.status_code == 200 and applicants.json()["total"] == 1

    # reopen: back on the board and the link works again
    assert client.patch(f"/api/vendor/jobs/{job['id']}", json={"status": "published"}, headers=h).status_code == 200
    assert client.get(f"/api/jobs/public/{code}").status_code == 200
    board = client.get("/api/jobs?scope=all", headers=w["cand"]["h"]).json()["jobs"]
    assert job["id"] in [j["id"] for j in board]

    # unpublish (draft) hides it the same way
    assert client.patch(f"/api/vendor/jobs/{job['id']}", json={"status": "draft"}, headers=h).status_code == 200
    assert client.get(f"/api/jobs/public/{code}").status_code == 410

    # every change is in the audit trail, for this organisation
    import time

    from app.db import store

    rows = []
    for _ in range(20):  # audit rows are written in the background
        with store.db_pool(os.environ["TEST_DATABASE_URL"]).connection() as conn:
            rows = conn.execute(
                "SELECT action, organization_id, meta FROM audit_logs WHERE entity_type = 'job' AND entity_id = %s",
                (job["id"],),
            ).fetchall()
        if len(rows) >= 3:
            break
        time.sleep(0.1)
    assert len(rows) >= 3
    assert all(r["action"] == "job.updated" for r in rows)
    assert {r["meta"]["statusTo"] for r in rows} == {"closed", "published", "draft"}


@needs_db
def test_edit_jd_keeps_completed_interview_questions(client, lifecycle_world, fake_llm):
    """An edited JD reaches new interviews; an interview that already ran keeps the questions it was asked."""
    from app.db import store
    from tests.test_qa_e2e_db import CONSENT, RESUME

    w = lifecycle_world
    job, h, cand = w["job"], w["a"]["h"], w["cand"]
    code = job["shareableCode"]
    app_id = client.post(f"/api/jobs/public/{code}/apply", json={"resumeText": RESUME}, headers=cand["h"]).json()[
        "applicationId"
    ]
    start = client.post("/api/interview/start", json={"applicationId": app_id, "consent": CONSENT}, headers=cand["h"])
    assert start.status_code == 200, start.text
    s = start.json()
    asked = [q.get("text") for q in s["questions"] if q.get("text")]
    assert asked
    answer = "I designed idempotent FastAPI endpoints backed by PostgreSQL with unique keys and Kafka retries."
    done = client.post("/api/interview/score", json={"sessionId": s["sessionId"], "answers": [answer] * len(s["questions"])},
                       headers=cand["h"])
    assert done.status_code == 200, done.text

    def stored_questions(session_id: str) -> list:
        with store.db_pool(os.environ["TEST_DATABASE_URL"]).connection() as conn:
            row = conn.execute("SELECT data FROM interview_sessions WHERE session_id = %s", (session_id,)).fetchone()
        data = (row or {}).get("data") or {}
        return [q.get("text") for q in data.get("questions") or [] if isinstance(q, dict) and q.get("text")]

    before = stored_questions(s["sessionId"])
    new_jd = "Rewritten JD: Go and Kubernetes platform engineer running gRPC services and Terraform on AWS. " * 2
    edited = client.patch(
        f"/api/vendor/jobs/{job['id']}",
        json={"jobDescription": new_jd, "requiredSkills": ["Go", "Kubernetes", "Terraform"], "title": "Platform Engineer"},
        headers=h,
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["job"]["jobDescription"] == new_jd.strip()
    assert set(edited.json()["changed"]) == {"jobDescription", "requiredSkills", "title"}
    # The completed interview is untouched: same questions on the session, report still on the application.
    assert stored_questions(s["sessionId"]) == before
    applicants = client.get(f"/api/vendor/jobs/{job['id']}/applicants", headers=h).json()["applicants"]
    mine = next(a for a in applicants if a["id"] == app_id)
    assert mine["data"].get("interviewResult")

    # A new interview is planned from the new JD and skills.
    fake_llm.clear()
    other = _signup_cand(client)
    app2 = client.post(f"/api/jobs/public/{code}/apply", json={"resumeText": RESUME}, headers=other["h"]).json()
    s2 = client.post(
        "/api/interview/start", json={"applicationId": app2["applicationId"], "consent": CONSENT}, headers=other["h"]
    )
    assert s2.status_code == 200, s2.text
    planner_input = repr(fake_llm)
    assert "Kubernetes" in planner_input and "Terraform" in planner_input
    assert "Rewritten JD" in planner_input


def _signup_cand(client):
    from tests.test_qa_e2e_db import _signup

    return _signup(client, name="Late Cand")
