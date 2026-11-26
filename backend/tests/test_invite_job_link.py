"""T3 #1: an interview started from a recruiter's job-scoped open invite ("Invite by email" or the applicant row's
"Invite") must be saved against the job, organization and application so the recruiter sees it."""

from __future__ import annotations

import pytest

from app.db import store as db_store
from app.dispatch import api_dispatch
from app.server import runtime
from tests.test_interview_invites import CONSENT, _auth, env  # noqa: F401  (pytest fixture)


@pytest.fixture(autouse=True)
def _no_real_rows(monkeypatch):
    """The fake database URL has no Postgres behind it: application rows stay in the in-memory database."""
    monkeypatch.setattr(db_store, "upsert_employer_application_record", lambda *_a, **_k: None)
    monkeypatch.setattr(db_store, "upsert_job_application_record", lambda *_a, **_k: None)
    monkeypatch.setattr(db_store, "sync_open_jobs_from_database", lambda *_a, **_k: None)

    async def _no_grant(*_a, **_k):
        return None

    monkeypatch.setattr(api_dispatch, "grant_organization_talent_access", _no_grant)


JOB = {
    "id": "job-fs", "organizationId": "org1", "title": "Full Stack Engineer", "status": "published",
    "jobDescription": "Build React and Node.js services with PostgreSQL. " * 5, "requiredSkills": ["React", "Node.js"],
    "createdAt": "2026-11-01", "createdByUserId": "u-rec", "createdByEmail": "recruiter@acme.test",
}


def _send_job_invite(client):
    res = client.post(
        "/api/vendor/interview-invites/send",
        headers=_auth("tok-employer"),
        json={"candidates": [{"email": "asha@example.com", "name": "Asha Rao"}], "jobId": "job-fs"},
    )
    assert res.status_code in (200, 201), res.text
    return res.json()["invites"][0]["inviteUrl"].rsplit("/", 1)[1]


def test_open_job_invite_creates_and_links_the_application(env):
    client, pool, _sent, _ = env
    db = runtime.load_db()
    db["jobs"] = [dict(JOB)]  # fresh lists: the shared fixture copies the previous test's collections
    db["employerApplications"] = []
    token = _send_job_invite(client)
    assert pool.rows[token]["job_id"] == "job-fs" and pool.rows[token]["application_id"] is None

    res = client.post(
        "/api/interview/start",
        headers=_auth("tok-asha"),
        # A stale job left in the browser must not win over the invite.
        json={"role": "Full Stack Engineer", "inviteToken": token, "jobId": "some-other-job", "consent": CONSENT},
    )
    assert res.status_code == 200, res.text
    session = db["interviewSessions"][res.json()["sessionId"]]
    apps = [a for a in db["employerApplications"] if a["jobId"] == "job-fs" and a["candidateEmail"] == "asha@example.com"]
    assert len(apps) == 1
    assert session["jobId"] == "job-fs" and session["organizationId"] == "org1"
    assert session["applicationId"] == apps[0]["id"]
    assert apps[0]["data"]["source"] == "invite"
    assert session["careerInterview"] is False

    # The same invite opened again (or the job interview reopened in a new tab without the token) reuses the session
    # and does not create a second application.
    again = client.post("/api/interview/start", headers=_auth("tok-asha"),
                        json={"inviteToken": token, "consent": CONSENT})
    assert again.json()["sessionId"] == res.json()["sessionId"]
    new_tab = client.post("/api/interview/start", headers=_auth("tok-asha"),
                          json={"applicationId": apps[0]["id"], "consent": CONSENT})
    assert new_tab.json()["sessionId"] == res.json()["sessionId"]
    assert len([a for a in db["employerApplications"] if a["jobId"] == "job-fs"]) == 1


def test_invite_reuses_an_existing_application(env):
    client, pool, _sent, _ = env
    db = runtime.load_db()
    db["jobs"] = [dict(JOB)]
    db["employerApplications"] = [
        {"id": "app-asha", "organizationId": "org1", "jobId": "job-fs", "candidateEmail": "asha@example.com", "data": {}}
    ]
    token = _send_job_invite(client)
    res = client.post("/api/interview/start", headers=_auth("tok-asha"), json={"inviteToken": token, "consent": CONSENT})
    assert res.status_code == 200, res.text
    assert db["interviewSessions"][res.json()["sessionId"]]["applicationId"] == "app-asha"
    assert len(db["employerApplications"]) == 1
