"""End-to-end test of the emailed interview link: send -> open link -> sign in -> interview built from the resume.

Uses an in-memory fake of the invites table and a fake mail sender; no database, SMTP or LLM is touched.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timedelta, timezone

import pytest

# SAFETY: the repo-root .env may hold real credentials. Blank them BEFORE the app (and its config) is imported.
for _k in (
    "DATABASE_URL", "S3_BUCKET", "S3_EXPECTED_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
    "SMTP_EMAIL", "SMTP_APP_PASSWORD", "RESEND_API_KEY", "EMAIL_FROM", "GEMINI_API_KEY", "GOOGLE_API_KEY",
):
    os.environ[_k] = ""
os.environ["ENVIRONMENT"] = "development"
os.environ["PUBLIC_APP_URL"] = "https://app.example.test"

from fastapi.testclient import TestClient  # noqa: E402

from app.db import store as db_store  # noqa: E402
from app.dispatch import api_dispatch, route_extensions  # noqa: E402
from app.main import app  # noqa: E402
from app.node_config import config  # noqa: E402
from app.server import runtime  # noqa: E402
from app.services import interview_invites  # noqa: E402

COLUMNS = [
    "token", "organization_id", "application_id", "job_id", "candidate_email", "candidate_name",
    "job_title", "scheduled_start", "scheduled_end", "created_by_user_id", "email_sent_at", "context_json",
]

RESUME = (
    "Asha Rao. Full Stack Engineer. Built a payments dashboard in React and TypeScript for 300 finance users. "
    "Cut API latency from 700ms to 210ms with Redis caching and PostgreSQL indexing. Led a Node.js microservices migration on AWS."
)


class _Cursor:
    def __init__(self, row=None):
        self._row = row

    def fetchone(self):
        return self._row


class _Conn:
    def __init__(self, rows):
        self.rows = rows

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=()):
        s = " ".join(sql.split()).upper()
        if s.startswith("INSERT INTO INTERVIEW_INVITES"):
            row = dict(zip(COLUMNS, params))
            self.rows[row["token"]] = row
            return _Cursor()
        if s.startswith("SELECT * FROM INTERVIEW_INVITES"):
            return _Cursor(self.rows.get(params[0]))
        if s.startswith("UPDATE INTERVIEW_INVITES SET EMAIL_SENT_AT"):
            if params[0] in self.rows:
                self.rows[params[0]]["email_sent_at"] = "now"
            return _Cursor()
        return _Cursor()

    def commit(self):
        pass


class _Pool:
    def __init__(self):
        self.rows: dict[str, dict] = {}

    def connection(self):
        return _Conn(self.rows)


@pytest.fixture
def env(monkeypatch):
    pool = _Pool()
    sent: list[dict] = []
    captured_batch: list[dict] = []
    sessions = {"tok-employer": "recruiter@acme.test", "tok-asha": "asha@example.com", "tok-other": "other@example.com"}

    original_url = config.database_url
    object.__setattr__(config, "database_url", "postgresql://fake/fake")  # frozen dataclass; restored below
    monkeypatch.setattr(runtime, "_restore_marker", original_url, raising=False)
    monkeypatch.setattr(db_store, "db_pool", lambda _url: pool)
    monkeypatch.setattr(runtime, "persist_db", lambda *_a, **_k: None)
    monkeypatch.setattr(runtime, "resolve_session_email", lambda _url, tok: sessions.get(tok))

    async def fake_send_mail(*, to, subject, html, text=None):
        sent.append({"to": to, "subject": subject, "html": html, "text": text})

    monkeypatch.setattr(interview_invites, "send_mail", fake_send_mail)
    monkeypatch.setattr(route_extensions, "smtp_configured", lambda: True)
    monkeypatch.setattr(interview_invites, "smtp_configured", lambda: True)

    async def fake_batch(payload):
        captured_batch.append(payload)
        qs = [{"text": f"Question {i} about your resume work in detail?", "category": "Technical", "keywords": [], "focus": "adaptive-llm"} for i in range(1, 7)]
        qs += [{"text": "", "focus": "pending-fallback"}, {"text": "", "focus": "pending-closing"}]
        return {"questions": qs, "fallbackTurn": 7, "closingTurn": 8, "totalTurns": 8}

    monkeypatch.setattr(api_dispatch.ia, "generate_adaptive_question_batch", fake_batch)

    base = runtime.load_db()
    runtime.set_db_cache(
        {
            **base,
            "users": [
                {"id": "u-rec", "name": "Rita Recruiter", "email": "recruiter@acme.test", "role": "employer", "status": "active", "primaryOrganizationId": "org1"},
                {"id": "u-asha", "name": "Asha Rao", "email": "asha@example.com", "role": "jobseeker", "status": "active"},
                {"id": "u-oth", "name": "Other Person", "email": "other@example.com", "role": "jobseeker", "status": "active"},
            ],
            "organizations": [{"id": "org1", "name": "Acme Hiring"}],
            "organizationMembers": [{"userId": "u-rec", "organizationId": "org1", "role": "owner"}],
            "profiles": {
                "asha@example.com": {
                    "fullName": "Asha Rao", "currentRole": "Full Stack Engineer", "skills": ["React", "Node.js", "PostgreSQL"],
                    "resumeText": RESUME, "totalExperience": "3 – 5 Years", "completedSteps": 5,
                }
            },
            "interviewSessions": {},
        }
    )
    client = TestClient(app)
    yield client, pool, sent, captured_batch
    object.__setattr__(config, "database_url", original_url)


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _send_invite(client):
    return client.post(
        "/api/vendor/interview-invites/send",
        headers=_auth("tok-employer"),
        json={"candidates": [{"email": "asha@example.com", "name": "Asha Rao"}], "jobTitle": "Full Stack Engineer"},
    )


def test_recruiter_sends_invite_email_with_working_link(env):
    client, pool, sent, _ = env
    res = _send_invite(client)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["invites"][0]["emailSent"] is True
    assert len(sent) == 1 and sent[0]["to"] == "asha@example.com"
    mail = sent[0]
    url = body["invites"][0]["inviteUrl"]
    assert url.startswith("https://app.example.test/interview/invite/")
    assert url in mail["html"] and url in mail["text"]
    assert "Start your interview" in mail["html"]
    assert "Asha" in mail["html"] and "Full Stack Engineer" in mail["subject"]
    assert "resume" in mail["html"].lower()
    token = url.rsplit("/", 1)[1]
    assert token in pool.rows


def test_only_employers_can_send_invites(env):
    client, *_ = env
    res = client.post("/api/vendor/interview-invites/send", headers=_auth("tok-asha"), json={"email": "x@y.com"})
    assert res.status_code == 403
    res = client.post("/api/vendor/interview-invites/send", json={"email": "x@y.com"})
    assert res.status_code == 401


def test_invalid_and_duplicate_emails_are_filtered(env):
    client, pool, sent, _ = env
    res = client.post(
        "/api/vendor/interview-invites/send",
        headers=_auth("tok-employer"),
        json={"candidates": [{"email": "not-an-email"}, {"email": "A@x.com"}, {"email": "a@x.com"}]},
    )
    assert res.status_code == 201
    assert len(res.json()["invites"]) == 1
    assert client.post("/api/vendor/interview-invites/send", headers=_auth("tok-employer"), json={"candidates": [{"email": "bad"}]}).status_code == 400


def test_clicking_the_link_opens_immediately_and_hides_the_resume_from_strangers(env):
    client, pool, sent, _ = env
    token = _send_invite(client).json()["invites"][0]["inviteUrl"].rsplit("/", 1)[1]

    anon = client.get(f"/api/interview-invites/{token}").json()["invite"]
    assert anon["status"] == "open" and anon["canStart"] is True  # works right now, not only in a 5-minute window
    assert anon["resumeText"] == "" and anon["jobDescription"] == ""  # link holders do not get the resume
    assert anon["resumeReady"] is True and anon["signedInAsInvitee"] is False

    other = client.get(f"/api/interview-invites/{token}", headers=_auth("tok-other")).json()["invite"]
    assert other["resumeText"] == ""

    mine = client.get(f"/api/interview-invites/{token}", headers=_auth("tok-asha")).json()["invite"]
    assert mine["signedInAsInvitee"] is True and "payments dashboard" in mine["resumeText"]


def test_interview_started_from_the_link_is_built_from_the_candidates_resume(env):
    client, pool, sent, captured = env
    token = _send_invite(client).json()["invites"][0]["inviteUrl"].rsplit("/", 1)[1]
    res = client.post(
        "/api/interview/start",
        headers=_auth("tok-asha"),
        json={"role": "Full Stack Engineer", "level": "3 – 5 Years", "inviteToken": token},
    )
    assert res.status_code == 200, res.text
    assert res.json()["total"] == 8
    payload = captured[-1]
    assert "payments dashboard" in payload["ctx"]["resumeSnippet"]  # the questions are generated from HER resume
    assert "React" in payload["ctx"]["skills"]


def test_someone_else_cannot_use_the_link(env):
    client, *_ = env
    token = _send_invite(client).json()["invites"][0]["inviteUrl"].rsplit("/", 1)[1]
    res = client.post("/api/interview/start", headers=_auth("tok-other"), json={"inviteToken": token})
    assert res.status_code == 403
    assert "email address that received" in res.json()["error"]


def test_expired_link_is_refused(env):
    client, pool, *_ = env
    token = _send_invite(client).json()["invites"][0]["inviteUrl"].rsplit("/", 1)[1]
    pool.rows[token]["scheduled_end"] = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat().replace("+00:00", "Z")
    pool.rows[token]["scheduled_start"] = (datetime.now(timezone.utc) - timedelta(days=8)).isoformat().replace("+00:00", "Z")
    res = client.post("/api/interview/start", headers=_auth("tok-asha"), json={"inviteToken": token})
    assert res.status_code == 410
    page = client.get(f"/api/interview-invites/{token}").json()["invite"]
    assert page["status"] == "expired" and page["canStart"] is False


def test_unknown_token_is_404(env):
    client, *_ = env
    assert client.get("/api/interview-invites/" + "0" * 48).status_code == 404


def test_email_without_smtp_still_returns_a_shareable_link(env, monkeypatch):
    client, pool, sent, _ = env
    monkeypatch.setattr(route_extensions, "smtp_configured", lambda: False)
    res = _send_invite(client)
    assert res.status_code == 201
    inv = res.json()["invites"][0]
    assert inv["emailSent"] is False and "not configured" in inv["emailError"].lower() and inv["inviteUrl"]
    assert sent == []


def test_email_template_is_well_formed():
    mail = interview_invites.build_interview_invite_email(
        candidateName="Asha Rao", jobTitle="Role & Co <i>x</i>", scheduledStart="2030-01-01T10:00:00Z",
        scheduledEnd="2030-01-08T10:00:00Z", inviteUrl="https://x.test/interview/invite/abc", openInvite=True,
    )
    assert "&lt;i&gt;" in mail["html"] and "&amp; Co" in mail["html"]  # user-supplied text is escaped
    assert re.search(r"https://x\.test/interview/invite/abc", mail["text"])
    assert "active until" in mail["text"]
