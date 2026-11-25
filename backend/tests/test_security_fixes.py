"""Regression tests for the security audit (V-02 ... V-30). Each test reproduces the original exploit and proves it
no longer works. No real database, S3, SMTP or LLM is touched (DB-backed checks live in test_security_db.py)."""

from __future__ import annotations

import asyncio
import io
import os
import zipfile

import pytest

for _k in (
    "DATABASE_URL", "S3_BUCKET", "S3_EXPECTED_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
    "SMTP_EMAIL", "SMTP_APP_PASSWORD", "RESEND_API_KEY", "EMAIL_FROM", "GEMINI_API_KEY", "GOOGLE_API_KEY",
):
    os.environ[_k] = ""
os.environ["ENVIRONMENT"] = "development"

from fastapi.testclient import TestClient  # noqa: E402

from app.db import store as db_store  # noqa: E402
from app.dispatch import api_dispatch  # noqa: E402
from app.main import app  # noqa: E402
from app.node_config import config  # noqa: E402
from app.server import ratelimit, runtime  # noqa: E402

CONSENT = {"version": "2026-11-07", "recording": True, "faceTracking": True, "aiScoring": True}


# --------------------------------------------------------------------------------------------- fake Postgres pool
class _Cur:
    def __init__(self, row=None, rows=None):
        self._row, self._rows = row, rows or []

    def fetchone(self):
        return self._row

    def fetchall(self):
        return self._rows


class _RetakeConn:
    """Answers the retake-payment SQL like Postgres would: one free claim per email, no paid credits."""

    def __init__(self, state):
        self.state = state
        self.row_factory = None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=()):
        q = " ".join(sql.split()).upper()
        if q.startswith("SELECT COUNT(*) AS N FROM INTERVIEW_SESSIONS"):
            return _Cur({"n": 0})
        if q.startswith("SELECT COUNT(*) AS N FROM INTERVIEW_RETAKE_PAYMENTS"):
            return _Cur({"n": 0})
        if "STATUS = 'FREE_USED' LIMIT 1" in q:
            return _Cur({"used": 1} if params[0].lower() in self.state["free"] else None)
        if q.startswith("INSERT INTO INTERVIEW_RETAKE_PAYMENTS"):
            email = params[1]
            if email in self.state["free"]:
                return _Cur(None)  # ON CONFLICT DO NOTHING
            self.state["free"].add(email)
            return _Cur({"id": params[0]})
        if q.startswith("UPDATE INTERVIEW_RETAKE_PAYMENTS SET STATUS = 'USED'"):
            return _Cur(None)  # no paid credit
        return _Cur(None)

    def commit(self):
        pass


class _Pool:
    def __init__(self):
        self.state = {"free": set()}

    def connection(self):
        return _RetakeConn(self.state)


@pytest.fixture
def env(monkeypatch):
    pool = _Pool()
    sessions = {"tok-cand": "cand@example.com", "tok-emp": "rec@acme.test", "tok-off": "off@example.com"}
    original_url = config.database_url
    object.__setattr__(config, "database_url", "postgresql://fake/fake")
    monkeypatch.setattr(db_store, "db_pool", lambda _url: pool)
    monkeypatch.setattr(runtime, "persist_db", lambda *_a, **_k: None)
    monkeypatch.setattr(runtime, "resolve_session_email", lambda _url, tok: sessions.get(tok))
    runtime._SESSION_CACHE.clear()
    ratelimit.reset_for_tests()

    async def fake_batch(payload):
        qs = [{"text": f"Question {i} about your resume work in detail?", "category": "Technical", "keywords": []} for i in range(1, 7)]
        return {"questions": qs, "totalTurns": 6}

    monkeypatch.setattr(api_dispatch.ia, "generate_adaptive_question_batch", fake_batch)
    # The talent index imports db_pool directly: keep it away from the fake database URL.
    from app.db import talent_index
    from app.routes import auth_node

    async def no_talent(*_a, **_k):
        return None

    async def no_search(*_a, **_k):
        return {"total": 0, "candidates": []}

    monkeypatch.setattr(auth_node, "upsert_candidate_talent", no_talent)
    monkeypatch.setattr(api_dispatch, "upsert_candidate_talent", no_talent)
    monkeypatch.setattr(api_dispatch, "search_candidate_talent", no_search)
    monkeypatch.setattr(talent_index, "db_pool", lambda _url: pool)
    base = runtime.load_db()
    db = {
        **base,
        "users": [
            {"id": "u-cand", "name": "Cand", "email": "cand@example.com", "role": "jobseeker", "status": "active"},
            {"id": "u-rec", "name": "Rec", "email": "rec@acme.test", "role": "employer", "status": "active",
             "primaryOrganizationId": "org1"},
            {"id": "u-off", "name": "Off", "email": "off@example.com", "role": "jobseeker", "status": "disabled"},
        ],
        "organizations": [{"id": "org1", "name": "Acme", "status": "active"}],
        "organizationMembers": [{"userId": "u-rec", "organizationId": "org1", "role": "owner"}],
        "profiles": {"cand@example.com": {"fullName": "Cand", "resumeText": "Python developer " * 10,
                                          "resumeStoragePath": "users/u-cand/resume/resume.pdf"}},
        "jobs": [{"id": "job-open", "organizationId": "org1", "title": "Backend Engineer", "status": "published",
                  "jobDescription": "Python APIs " * 20, "requiredSkills": ["Python"], "createdAt": "2026-11-01"}],
        "employerApplications": [],
        "interviewSessions": {},
        "interviews": {},
    }
    runtime.set_db_cache(db)
    client = TestClient(app)
    yield client, db, pool
    object.__setattr__(config, "database_url", original_url)
    ratelimit.reset_for_tests()
    runtime._SESSION_CACHE.clear()


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


# --------------------------------------------------------------------------------------------- V-02 / V-03
def test_profile_put_cannot_set_server_owned_storage_fields():
    from app.routes.auth_node import sanitize_profile_patch

    patch = sanitize_profile_patch(
        {"fullName": "A", "resumeStoragePath": "users/victim/video/s.webm", "resumeUrl": "x", "interviewScore": 100,
         "storageProvider": "s3", "profileVisibility": "everyone", "shareContactWithRecruiters": "yes"}
    )
    assert patch == {"fullName": "A", "shareContactWithRecruiters": False}


def test_profile_endpoint_keeps_the_stored_resume_key(env):
    client, db, _ = env
    res = client.put("/api/profile", headers=_auth("tok-cand"),
                     json={"currentRole": "Dev", "resumeStoragePath": "users/u-rec/resume/resume.pdf"})
    assert res.status_code == 200
    assert db["profiles"]["cand@example.com"]["resumeStoragePath"] == "users/u-cand/resume/resume.pdf"
    assert db["profiles"]["cand@example.com"]["currentRole"] == "Dev"


@pytest.mark.parametrize(
    "key",
    ["users/victim/resume/resume.pdf", "users/u-cand/video/s1.webm", "users/u-cand/resume/../../victim/resume/r.pdf",
     "other/u-cand/resume/r.pdf", ""],
)
def test_resume_download_refuses_keys_outside_the_owners_resume_folder(key, monkeypatch):
    from app.services.storage import resume_storage

    monkeypatch.setattr(resume_storage, "presign_download", lambda k, **kw: {"url": f"https://s3/{k}", "expiresInSeconds": 60})
    with pytest.raises(ValueError) as err:
        asyncio.run(resume_storage.resolve_resume_download_from_profile(
            {"resumeStoragePath": key}, None, owner_user_id="u-cand", owner_email="cand@example.com"))
    assert getattr(err.value, "status", None) == 404


def test_resume_download_allows_the_owners_own_file(monkeypatch):
    from app.services.storage import resume_storage

    monkeypatch.setattr(resume_storage, "presign_download", lambda k, **kw: {"url": f"https://s3/{k}", "expiresInSeconds": 60})
    out = asyncio.run(resume_storage.resolve_resume_download_from_profile(
        {"resumeStoragePath": "users/u-cand/resume/resume.pdf"}, None, owner_user_id="u-cand"))
    assert out["url"].endswith("users/u-cand/resume/resume.pdf")


class _PurgeConn:
    def __init__(self, deleted_rows):
        self.deleted_rows = deleted_rows

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=()):
        q = " ".join(sql.split()).upper()
        if q.startswith("SELECT S3_OBJECT_KEY FROM INTERVIEW_RECORDINGS"):
            # dict rows, like the app pool (dict_row): `for (key,) in rows` used to yield the column NAME (V-30)
            return _Cur(rows=[{"s3_object_key": "users/u-cand/video/s1.webm"}, {"s3_object_key": "users/victim/video/v.webm"}])
        if q.startswith("SELECT S3_OBJECT_KEY FROM INTERVIEW_ARTIFACTS"):
            return _Cur(rows=[{"s3_object_key": "users/u-cand/report/s1.pdf"}])
        return _Cur()

    def commit(self):
        pass


def test_resume_replace_purge_deletes_only_the_callers_objects(monkeypatch):
    from app.services import resume_replace

    deleted = []
    monkeypatch.setattr(resume_replace, "delete_object", deleted.append)
    monkeypatch.setattr(resume_replace, "s3_storage_configured", lambda: True)
    pool = type("P", (), {"connection": lambda self: _PurgeConn(deleted)})()
    counts = resume_replace._purge_postgres_sync(
        pool, "cand@example.com", {"resumeStoragePath": "users/victim/resume/resume.pdf"}, "u-cand"
    )
    assert deleted == ["users/u-cand/video/s1.webm", "users/u-cand/report/s1.pdf"]  # real keys, never the victim's
    assert counts == {"recordings": 2, "artifacts": 1}


# --------------------------------------------------------------------------------------------- V-04
def test_candidate_cannot_store_a_forged_interview_result(env):
    client, db, _ = env
    res = client.post("/api/interview", headers=_auth("tok-cand"), json={"overall": 100, "role": "CTO"})
    assert res.status_code == 400
    assert "cand@example.com" not in db["interviews"]
    # someone else's completed session is refused too
    db["interviewSessions"]["s-other"] = {"email": "rec@acme.test", "status": "completed", "result": {"overall": 99}}
    assert client.post("/api/interview", headers=_auth("tok-cand"), json={"sessionId": "s-other", "overall": 100}).status_code == 400


def test_server_scored_result_is_saved_and_body_fields_are_ignored(env):
    client, db, _ = env
    db["interviewSessions"]["s1"] = {"email": "cand@example.com", "status": "completed", "result": {"overall": 61, "sessionId": "s1"}}
    res = client.post("/api/interview", headers=_auth("tok-cand"), json={"sessionId": "s1", "overall": 100})
    assert res.status_code == 200
    assert db["interviews"]["cand@example.com"]["overall"] == 61


# --------------------------------------------------------------------------------------------- V-05 (reversed)
# OWNER DECISION: contact details, resume and report are shown for every employer-visible candidate. Hidden
# (private / organization_only) profiles with no link to the organization stay out.
def _roster_db():
    return {
        "users": [
            {"id": "u1", "email": "seek@x.com", "role": "jobseeker"},
            {"id": "u2", "email": "opt@x.com", "role": "jobseeker"},
            {"id": "u3", "email": "priv@x.com", "role": "jobseeker"},
            {"id": "u4", "email": "boss@x.com", "role": "employer"},
        ],
        "profiles": {"opt@x.com": {"shareContactWithRecruiters": True}, "priv@x.com": {"profileVisibility": "private"}},
        "employerApplications": [],
        "interviewSessions": {},
        "organizationMembers": [],
    }


def test_visible_candidates_keep_contact_details_hidden_profiles_are_dropped():
    from app.services.vendor.candidate_documents import redact_roster_rows

    rows = [
        {"source": "platform", "candidateEmail": "seek@x.com", "candidatePhone": "999", "resumeText": "call me",
         "resumeName": "r.pdf", "candidateName": "Seeker", "primarySkills": ["Python"]},
        {"source": "platform", "candidateEmail": "priv@x.com", "candidatePhone": "888", "resumeText": "secret"},
        {"source": "application", "candidateEmail": "app@x.com", "candidatePhone": "777", "resumeText": "applied"},
    ]
    out = redact_roster_rows(_roster_db(), rows)
    assert [r["candidateEmail"] for r in out] == ["seek@x.com", "app@x.com"]
    assert out[0]["candidatePhone"] == "999" and out[0]["resumeText"] == "call me" and out[0]["contactHidden"] is False
    assert out[1]["candidatePhone"] == "777"


def test_resume_file_rule_any_employer_but_not_private_roles_or_unknown():
    from app.services.vendor.candidate_documents import assert_vendor_may_view_candidate_documents

    db = _roster_db()
    assert_vendor_may_view_candidate_documents(db, "org1", "seek@x.com", contact=True)
    assert_vendor_may_view_candidate_documents(db, "org1", "opt@x.com", contact=True)
    for denied in ("priv@x.com", "boss@x.com", "nobody@x.com"):
        with pytest.raises(ValueError):
            assert_vendor_may_view_candidate_documents(db, "org1", denied, contact=True)
    db["employerApplications"].append({"organizationId": "org1", "candidateEmail": "priv@x.com", "jobId": "j"})
    assert_vendor_may_view_candidate_documents(db, "org1", "priv@x.com", contact=True)  # applied here
    with pytest.raises(ValueError):
        assert_vendor_may_view_candidate_documents(db, "org2", "priv@x.com", contact=True)


def test_talent_hits_keep_email():
    from app.services.vendor.candidate_documents import redact_talent_hits

    hits = [{"userId": "u1", "email": "seek@x.com", "resumePreview": "phone 999", "fullName": "S"}]
    out = redact_talent_hits(_roster_db(), "org1", hits)
    assert out[0]["email"] == "seek@x.com" and out[0]["resumePreview"] == "phone 999" and out[0]["contactHidden"] is False


# --------------------------------------------------------------------------------------------- V-06
def test_parallel_free_interviews_only_one_is_free(env):
    client, db, pool = env
    first = client.post("/api/interview/start", headers=_auth("tok-cand"), json={"consent": CONSENT, "role": "Dev"})
    assert first.status_code == 200, first.text
    # The first session is still running (not completed): the old check counted only COMPLETED interviews.
    second = client.post("/api/interview/start", headers=_auth("tok-cand"), json={"consent": CONSENT, "role": "Dev"})
    assert second.status_code == 402
    assert second.json()["code"] == "RETAKE_PAYMENT_REQUIRED"
    assert db["interviewSessions"][first.json()["sessionId"]]["careerInterview"] is True


def test_a_public_job_id_alone_does_not_make_the_interview_free(env):
    client, db, pool = env
    pool.state["free"].add("cand@example.com")  # free interview already used
    res = client.post("/api/interview/start", headers=_auth("tok-cand"), json={"consent": CONSENT, "jobId": "job-open"})
    assert res.status_code == 402


def test_job_interview_with_own_application_stays_free(env):
    client, db, pool = env
    pool.state["free"].add("cand@example.com")
    db["employerApplications"].append({"id": "app-1", "organizationId": "org1", "jobId": "job-open",
                                       "candidateEmail": "cand@example.com", "data": {}})
    res = client.post("/api/interview/start", headers=_auth("tok-cand"), json={"consent": CONSENT, "jobId": "job-open"})
    assert res.status_code == 200, res.text
    session = db["interviewSessions"][res.json()["sessionId"]]
    assert session["careerInterview"] is False and session["applicationId"] == "app-1"


# --------------------------------------------------------------------------------------------- V-07
def _docx(xml: bytes) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("word/document.xml", xml)
    return buf.getvalue()


def test_docx_zip_bomb_is_refused():
    from app.services.resume_text import docx_text

    bomb = _docx(b"<w:t>" + b"A" * 60_000_000 + b"</w:t>")
    assert len(bomb) < 200_000
    assert docx_text(bomb) == ""


def test_docx_with_many_entries_is_refused_and_normal_docx_reads():
    from app.services.resume_text import docx_text

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for i in range(600):
            zf.writestr(f"x/{i}.xml", b"x")
        zf.writestr("word/document.xml", b"<w:p><w:t>Hello</w:t></w:p>")
    assert docx_text(buf.getvalue()) == ""
    assert docx_text(_docx(b"<w:p><w:t>Python developer</w:t></w:p>")) == "Python developer"


# --------------------------------------------------------------------------------------------- V-08
def test_oversized_bodies_are_rejected_before_reading(client):
    big = b"{" + b" " * (config.max_body_bytes + 10) + b"}"
    res = client.post("/api/contact", content=big, headers={"Content-Type": "application/json"})
    assert res.status_code == 413
    res = client.put("/api/profile", content=big, headers={"Content-Type": "application/json"})
    assert res.status_code == 413


def test_chunked_body_is_cut_off_at_the_limit(client):
    def gen():
        for _ in range(40):
            yield b" " * 100_000

    res = client.post("/api/contact", content=gen(), headers={"Content-Type": "application/json"})
    assert res.status_code == 413


def test_upload_routes_get_a_larger_allowance():
    from app.server.security import body_limit_for

    assert body_limit_for("/api/interview/recordings/upload") > 100_000_000
    assert body_limit_for("/api/resume/replace") >= 4_000_000
    assert body_limit_for("/api/profile") == config.max_body_bytes


def test_resume_parse_refuses_huge_base64_before_decoding(client):
    res = client.post("/api/resume/parse", json={"fileData": "A" * 2_900_000, "fileName": "r.pdf"})
    assert res.status_code == 413


# --------------------------------------------------------------------------------------------- V-09
def test_presigned_upload_is_bound_to_the_approved_size(monkeypatch):
    from app.services.storage import s3_storage

    monkeypatch.setenv("S3_BUCKET", "b")
    monkeypatch.setenv("AWS_REGION", "ap-south-1")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIAEXAMPLEEXAMPLE00")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "x" * 40)
    s3_storage.reset_client_cache()
    out = s3_storage.presign_upload(key="users/u/video/s.webm", content_type="video/webm", content_length=1234)
    assert "content-length" in out["url"].lower()  # Content-Length is a signed header
    assert out["headers"]["Content-Length"] == "1234"
    with pytest.raises(ValueError):
        s3_storage.presign_upload(key="users/u/video/s.webm", content_type="video/webm", content_length=None)
    s3_storage.reset_client_cache()


def test_oversized_completed_upload_is_deleted(monkeypatch):
    from app.services.storage import interview_recording_storage as rec

    deleted, updates = [], []
    monkeypatch.setattr(rec.rec_repo, "get_interview_recording_by_id", lambda pool, rid: {
        "interview_id": "s1", "s3_object_key": "users/u/video/s1.webm", "file_size_bytes": 1000, "candidate_email": "c@x.com"})
    monkeypatch.setattr(rec.rec_repo, "can_access_interview_recording", lambda email, row: True)
    monkeypatch.setattr(rec, "head_object", lambda key: {"ContentLength": 5_000_000_000})
    monkeypatch.setattr(rec, "delete_object", deleted.append)
    monkeypatch.setattr(rec.rec_repo, "update_interview_recording", lambda pool, rid, patch: updates.append(patch))
    with pytest.raises(rec.StorageError) as err:
        asyncio.run(rec.complete_interview_recording_upload(pool=None, requesterEmail="c@x.com", recordingId="r1", sessionId="s1"))
    assert err.value.status == 413 and deleted == ["users/u/video/s1.webm"] and updates == [{"status": "failed"}]


# --------------------------------------------------------------------------------------------- V-12 / V-20 / V-22 / V-23
def test_security_headers_on_api_responses(client):
    res = client.get("/api/health/live")
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"
    assert "frame-ancestors 'none'" in res.headers["content-security-policy"]
    assert res.headers["referrer-policy"] == "strict-origin-when-cross-origin"


def test_public_health_hides_infrastructure_details_in_production(client, monkeypatch):
    from app.routes import health_node

    monkeypatch.setattr(health_node, "is_prod_like", True)
    monkeypatch.setenv("CRON_SECRET", "s" * 32)
    monkeypatch.setenv("S3_BUCKET", "secret-bucket-name")
    public = client.get("/api/health").json()
    assert public["ok"] is True and "objectStorage" not in public and "llmFailover" not in public
    assert "secret-bucket-name" not in str(public)
    full = client.get("/api/health", headers={"X-Cron-Secret": "s" * 32}).json()
    assert full["objectStorage"]["bucket"] == "secret-bucket-name"


def test_disabled_user_on_confidential_routes_is_403_not_500(env):
    client, db, _ = env
    runtime._SESSION_CACHE.clear()
    # a disabled account cannot authenticate at all; an enabled jobseeker without an org gets 403
    assert client.get("/api/confidential/candidates", headers=_auth("tok-off")).status_code == 401
    assert client.get("/api/confidential/candidates", headers=_auth("tok-cand")).status_code == 403


def test_bad_query_numbers_are_not_500(env, monkeypatch):
    client, db, _ = env
    monkeypatch.setattr(db_store, "sync_open_jobs_from_database", lambda url, d: d)
    res = client.get("/api/jobs?summary=1&limit=abc&offset=-x", headers=_auth("tok-cand"))
    assert res.status_code == 200
    res = client.get("/api/talent/search?limit=x&offset=y&minScore=z", headers=_auth("tok-emp"))
    assert res.status_code == 200


def test_raw_storage_errors_are_not_returned_to_clients():
    from app.services.storage.resume_storage import public_object_storage_error

    leaked = RuntimeError("Could not connect to the endpoint URL: https://internal-host.ap-south-1.amazonaws.com")
    assert public_object_storage_error(leaked, "Upload failed.") == "Upload failed."
    ours = ValueError("Resume must be between 1 byte and 2 MB.")
    ours.status = 400
    assert public_object_storage_error(ours, "Upload failed.") == "Resume must be between 1 byte and 2 MB."


# --------------------------------------------------------------------------------------------- V-10
def test_open_invites_are_capped_per_organization_per_day(env, monkeypatch):
    client, db, pool = env
    from app.dispatch import route_extensions
    from app.services import interview_invites

    monkeypatch.setenv("INVITE_DAILY_RECIPIENT_LIMIT", "3")
    inserted = []

    async def fake_insert(_pool, row):
        inserted.append(row["candidateEmail"])

    monkeypatch.setattr(route_extensions, "insert_interview_invite", fake_insert)
    monkeypatch.setattr(route_extensions, "smtp_configured", lambda: False)
    monkeypatch.setattr(interview_invites, "smtp_configured", lambda: False)
    people = [{"email": f"p{i}@example.com"} for i in range(5)]
    res = client.post("/api/vendor/interview-invites/send", headers=_auth("tok-emp"), json={"candidates": people})
    assert res.status_code == 201, res.text
    assert len(inserted) == 3 and len(res.json()["skippedOverDailyLimit"]) == 2
    again = client.post("/api/vendor/interview-invites/send", headers=_auth("tok-emp"), json={"email": "q@example.com"})
    assert again.status_code == 429


# --------------------------------------------------------------------------------------------- V-13
def test_strict_limits_are_divided_across_workers_without_redis(monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.setenv("WEB_CONCURRENCY", "2")
    ratelimit.reset_for_tests()
    results = [ratelimit.allow("login-email:x@y.com", 10, 60_000, strict=True) for _ in range(6)]
    assert results == [True] * 5 + [False]  # 10 per minute in total across 2 workers -> 5 in this one
    ratelimit.reset_for_tests()


def test_signup_requires_the_same_password_length_as_reset(env):
    client, _, _ = env
    res = client.post("/api/signup", json={"name": "A", "email": "new@example.com", "password": "123456", "phone": "+919876543210"})
    assert res.status_code == 400
    assert "8" in res.json().get("detail", res.text)


# --------------------------------------------------------------------------------------------- V-14
def test_client_cannot_strip_server_recorded_proctoring_flags():
    from app.services.interview_integrity import merge_server_integrity

    session = {
        "integrity": {"faceViolations": 3, "singlePersonOk": False, "maxFacesSeen": 2},
        "reviewEvents": [{"id": "e1", "eventType": "MULTIPLE_FACES_DETECTED", "startOffsetSec": 5}],
    }
    merged = merge_server_integrity(session, {"faceViolations": 0, "singlePersonOk": True, "flaggedSections": [], "logs": []})
    assert merged["faceViolations"] == 3 and merged["singlePersonOk"] is False and merged["maxFacesSeen"] == 2
    assert merged["flaggedSections"] and merged["flaggedSections"][0]["type"] == "MULTIPLE_FACES_DETECTED"
    assert [e["id"] for e in merged["logs"]] == ["e1"]


def test_score_uses_the_sessions_role_and_level_not_the_clients(env, monkeypatch):
    client, db, _ = env
    seen = {}

    async def fake_score(payload):
        seen.update(payload)
        return {"overall": 50, "integrity": {}}

    monkeypatch.setattr(api_dispatch.ia, "score_interview_session", fake_score)
    db["interviewSessions"]["s9"] = {
        "email": "cand@example.com", "status": "active", "role": "Staff Engineer", "level": "8+ years",
        "questions": [{"text": "Explain the design of your last distributed system in detail?"}],
        "startedAt": "2099-01-01T00:00:00Z",
    }
    res = client.post("/api/interview/score", headers=_auth("tok-cand"),
                      json={"sessionId": "s9", "answers": ["my answer"], "role": "Intern", "level": "0 years",
                            "profile": {"fullName": "Forged"}})
    assert res.status_code == 200, res.text
    assert seen["role"] == "Staff Engineer" and seen["level"] == "8+ years"
    assert seen["profile"].get("fullName") != "Forged"


# --------------------------------------------------------------------------------------------- alerts consistency
def test_job_alerts_only_for_jobs_shown_on_the_matched_board():
    """The bell showed 3 job-match alerts while "matched roles" and "For you" showed none: alerts for closed jobs or
    for an older profile were returned forever. Now an alert is listed only if its job is on the matched board."""
    from app.services.vendor.alerts import list_candidate_job_alerts
    from app.services.vendor.job_role_match import apply_candidate_job_scope
    from app.services.vendor.jobs import list_open_jobs

    db = {
        "users": [{"id": "u", "email": "c@x.com", "role": "jobseeker"}],
        "profiles": {"c@x.com": {"currentRole": "Frontend Developer"}},
        "jobs": [
            {"id": "j-open", "title": "Frontend Developer", "roleTrack": "Frontend", "status": "published", "organizationId": "o"},
            {"id": "j-closed", "title": "Frontend Engineer", "roleTrack": "Frontend", "status": "archived", "organizationId": "o"},
            {"id": "j-other", "title": "Data Scientist", "roleTrack": "ML", "status": "published", "organizationId": "o"},
        ],
        "candidateJobAlerts": {"c@x.com": [
            {"jobId": "j-open", "read": False}, {"jobId": "j-closed", "read": False},
            {"jobId": "j-other", "read": False}, {"jobId": "j-gone", "read": False},
        ]},
    }
    alerts = {a["jobId"] for a in list_candidate_job_alerts(db, "c@x.com")}
    board = {j["id"] for j in apply_candidate_job_scope(db, "c@x.com", list_open_jobs(db), "matched")["jobs"]}
    assert alerts == {"j-open"} and alerts <= board
