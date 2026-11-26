"""End-to-end cases for the production Candidates page and original-resume download.

These run over HTTP against the in-memory database (no Neon, no S3). They cover the flow that is live on
Vercel + Render: an employer searches visible candidates, sees their contact details (OWNER DECISION, reverses the
earlier V-05 restriction), and Download saves the uploaded file rather than the extracted text.

Cases
1. A marketplace candidate with a stored file appears on the Candidates list with e-mail and phone.
2. Download by user id returns the original bytes and an attachment filename.
3. A private profile is not listed and its file cannot be downloaded.
4. A signed-out caller and a job seeker cannot download a resume.
5. Creating a job still publishes from the fields alone (no separate "type the details" step).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.node_config import config
from app.server import ratelimit, runtime

PDF = b"%PDF-1.4\noriginal resume bytes\n%%EOF"


class _Stored:
    def __init__(self, content: bytes, status_code: int = 200):
        self.content = content
        self.status_code = status_code


class _Http:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url: str):
        # The signed URL is the storage key (users/<id>/resume/<Original_Name>.pdf), not the literal "resume.pdf".
        assert url.startswith("https://s3.example/users/") and "/resume/" in url and url.endswith("?sig=1")
        return _Stored(PDF)


@pytest.fixture
def employer_client(monkeypatch):
    original_url = config.database_url
    object.__setattr__(config, "database_url", "")
    sessions = {"tok-emp": "recruiter@acme.test", "tok-seeker": "anita@example.com"}
    monkeypatch.setattr(runtime, "resolve_session_email", lambda _url, tok: sessions.get(tok))
    monkeypatch.setattr(runtime, "persist_db", lambda *_a, **_k: None)
    runtime._SESSION_CACHE.clear()
    ratelimit.reset_for_tests()
    db = {
        "users": [
            {"id": "u-emp", "email": "recruiter@acme.test", "name": "Rita Recruiter", "role": "employer"},
            {"id": "u-anita", "email": "anita@example.com", "name": "Anita Rao", "role": "jobseeker"},
            {"id": "u-private", "email": "private@example.com", "name": "Priv Person", "role": "jobseeker"},
        ],
        "organizations": [{"id": "org-a", "name": "Acme", "status": "active"}],
        "organizationMembers": [{"userId": "u-emp", "organizationId": "org-a", "role": "owner"}],
        "profiles": {
            "anita@example.com": {
                "fullName": "Anita Rao",
                "currentRole": "Frontend Developer",
                "totalExperience": "4 years",
                "currentLocation": "Bengaluru",
                "skills": ["React"],
                "resumeText": "Anita Rao\nFrontend Developer | anita@example.com | +91 90000 00000\nSkills: React",
                "resumeName": "Anita_Rao_Resume.pdf",
                "resumeStoragePath": "users/u-anita/resume/Anita_Rao_Resume.pdf",
            },
            "private@example.com": {
                "fullName": "Priv Person",
                "resumeText": "Secret",
                "profileVisibility": "private",
                "resumeStoragePath": "users/u-private/resume/secret.pdf",
            },
        },
        "jobs": [],
        "employerApplications": [],
        "interviewSessions": {},
        "interviews": {},
    }
    runtime.set_db_cache(db)

    async def fake_sign(profile, pool, **kwargs):
        key = str(profile.get("resumeStoragePath") or "")
        name = "Anita_Rao_Resume.pdf" if key.endswith("Anita_Rao_Resume.pdf") else "resume.pdf"
        return {
            "url": f"https://s3.example/{key}?sig=1",
            "expiresInSeconds": 300,
            "contentType": "application/pdf",
            "filename": name,
        }

    monkeypatch.setattr("app.dispatch.api_dispatch.resolve_resume_download_from_profile", fake_sign)
    monkeypatch.setattr("httpx.AsyncClient", _Http)
    client = TestClient(app)
    yield client, db
    object.__setattr__(config, "database_url", original_url)
    ratelimit.reset_for_tests()
    runtime._SESSION_CACHE.clear()


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_candidates_list_shows_contact_and_marks_the_original_file(employer_client):
    client, _db = employer_client
    res = client.get("/api/vendor/candidates?scope=platform", headers=_auth("tok-emp"))
    assert res.status_code == 200, res.text
    rows = {row["candidateName"]: row for row in res.json()["candidates"]}
    assert "Priv Person" not in rows
    anita = rows["Anita Rao"]
    assert anita["contactHidden"] is False
    assert anita["candidateEmail"] == "anita@example.com"
    assert anita["candidateUserId"] == "u-anita"
    assert anita["hasResumeFile"] is True
    assert anita["resumeName"] == "Anita_Rao_Resume.pdf"


def test_unlinked_employer_downloads_by_email_too(employer_client):
    client, _db = employer_client
    res = client.get("/api/vendor/candidate-documents/resume?email=anita@example.com&raw=1", headers=_auth("tok-emp"))
    assert res.status_code == 200, res.text
    assert res.content == PDF
    private = client.get("/api/vendor/candidate-documents/resume?email=private@example.com&raw=1", headers=_auth("tok-emp"))
    assert private.status_code == 404


def test_storage_failure_is_a_friendly_502_logged_with_the_key_prefix_only(employer_client, monkeypatch, caplog):
    client, _db = employer_client

    class _Denied(_Http):
        async def get(self, url: str):
            return _Stored(b"<Error><Code>AccessDenied</Code></Error>", status_code=403)

    monkeypatch.setattr("httpx.AsyncClient", _Denied)
    with caplog.at_level("WARNING"):
        res = client.get("/api/vendor/candidate-documents/resume?userId=u-anita&raw=1", headers=_auth("tok-emp"))
    assert res.status_code == 502
    assert res.json()["error"] == "Resume file could not be loaded. Please try again."
    assert "AccessDenied" not in res.text and "403" not in res.text
    logged = " ".join(r.getMessage() for r in caplog.records)
    assert "status=403" in logged and "key_prefix=users/u-anita/" in logged
    assert "Anita_Rao_Resume.pdf" not in logged


def test_download_returns_the_original_file_for_a_hidden_candidate(employer_client):
    client, _db = employer_client
    res = client.get(
        "/api/vendor/candidate-documents/resume?userId=u-anita&raw=1",
        headers=_auth("tok-emp"),
    )
    assert res.status_code == 200, res.text
    assert res.content == PDF
    assert res.headers["content-type"].startswith("application/pdf")
    disposition = res.headers["content-disposition"]
    assert disposition.startswith("attachment;")
    assert "Anita_Rao_Resume.pdf" in disposition


def test_raw_download_content_type_follows_pdf_name_not_stored_text(employer_client, monkeypatch):
    """text/plain on the stored object must not make Download save resume.pdf as text."""
    client, _db = employer_client

    async def text_plain_sign(profile, pool, **kwargs):
        key = str(profile.get("resumeStoragePath") or "")
        return {
            "url": f"https://s3.example/{key}?sig=1",
            "expiresInSeconds": 300,
            "contentType": "text/plain",
            "filename": "resume.pdf",
        }

    monkeypatch.setattr("app.dispatch.api_dispatch.resolve_resume_download_from_profile", text_plain_sign)
    res = client.get("/api/vendor/candidate-documents/resume?userId=u-anita&raw=1", headers=_auth("tok-emp"))
    assert res.status_code == 200, res.text
    assert res.content == PDF
    assert res.headers["content-type"].startswith("application/pdf")
    disposition = res.headers["content-disposition"].lower()
    assert "resume.pdf" in disposition
    assert ".txt" not in disposition


def test_download_link_is_separate_from_the_file_bytes(employer_client):
    client, _db = employer_client
    res = client.get(
        "/api/vendor/candidate-documents/resume?userId=u-anita",
        headers=_auth("tok-emp"),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["filename"] == "Anita_Rao_Resume.pdf"
    assert body["downloadUrl"].startswith("https://s3.example/users/u-anita/resume/")
    assert body["viewUrl"] == body["downloadUrl"]


def test_private_resume_cannot_be_downloaded_by_an_unlinked_employer(employer_client):
    client, _db = employer_client
    res = client.get(
        "/api/vendor/candidate-documents/resume?userId=u-private&raw=1",
        headers=_auth("tok-emp"),
    )
    assert res.status_code == 404
    assert res.content != PDF


def test_resume_download_requires_an_employer(employer_client):
    client, _db = employer_client
    assert client.get("/api/vendor/candidate-documents/resume?userId=u-anita&raw=1").status_code == 401
    seeker = client.get(
        "/api/vendor/candidate-documents/resume?userId=u-anita&raw=1",
        headers=_auth("tok-seeker"),
    )
    assert seeker.status_code == 403


def test_create_job_publishes_from_the_form_fields(employer_client):
    client, db = employer_client
    res = client.post(
        "/api/vendor/jobs",
        headers=_auth("tok-emp"),
        json={
            "title": "Frontend Developer",
            "jobDescription": "Build the hiring product in React. " * 8,
            "requiredSkills": ["React", "TypeScript"],
            "roleTrack": "Frontend Developer",
            "experienceLevel": "3-5 years",
            "location": "Bengaluru",
        },
    )
    assert res.status_code == 201, res.text
    job = res.json()["job"]
    assert job["title"] == "Frontend Developer"
    assert job["id"]
    assert any(item.get("id") == job["id"] for item in db["jobs"])
