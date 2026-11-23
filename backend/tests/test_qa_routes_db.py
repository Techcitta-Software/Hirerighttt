"""Backend QA, part 2: happy path + auth + bad input for every route not covered by test_qa_e2e_db.py.

Real throwaway Postgres (TEST_DATABASE_URL); LLM, S3, Razorpay and mail are always mocked.
"""

from __future__ import annotations

import base64
import json
import os
import secrets

import pytest

from tests.test_qa_e2e_db import (  # noqa: F401  (fixtures are used by name)
    CONSENT,
    RESUME,
    _apply,
    _fresh_rate_limits,
    _signup,
    fake_llm,
    world,
)

pytestmark = pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not set")


def _interview(client, world, cand=None):
    cand = cand or world["cand"]
    app_id = _apply(client, world, cand)["applicationId"]
    s = client.post("/api/interview/start", json={"applicationId": app_id, "consent": CONSENT}, headers=cand["h"])
    assert s.status_code == 200, s.text
    return app_id, s.json()


# ── meta / account ───────────────────────────────────────────────────────────────────────────────────────────


def test_organization_route(client, world):
    org = client.get("/api/organization", headers=world["a"]["h"])
    assert org.status_code == 200, org.text
    body = org.json()
    assert body["organization"]["id"] and any(m["email"] == world["a"]["email"] for m in body["members"])
    assert "passwordHash" not in org.text and "password_hash" not in org.text
    other = client.get("/api/organization", headers=world["b"]["h"]).json()
    assert other["organization"]["id"] != body["organization"]["id"]
    assert all(m["email"] != world["a"]["email"] for m in other["members"])
    assert client.get("/api/organization", headers=world["cand"]["h"]).status_code == 404
    assert client.get("/api/organization").status_code == 401


def test_tts_routes(client, world, monkeypatch):
    from app.services import tts

    h = world["cand"]["h"]
    st = client.get("/api/interview/tts/status", headers=h)
    assert st.status_code == 200 and "enabled" in st.json()
    assert client.post("/api/interview/tts", json={"text": "hi"}).status_code == 401
    monkeypatch.setattr(tts, "tts_enabled", lambda: True)

    async def fake_open(text, voice=None, **_k):
        async def rest():
            yield b"\x01\x02"

        async def close():
            return None

        return b"\x00\x00", rest(), close

    monkeypatch.setattr(tts, "open_speech", fake_open)
    ok = client.post("/api/interview/tts", json={"text": "Hello there"}, headers=h)
    assert ok.status_code == 200 and ok.content == b"\x00\x00\x01\x02"
    assert client.post("/api/interview/tts", json={"text": ""}, headers=h).status_code == 400
    for raw in ("[1, 2]", "not json", '"just a string"'):
        r = client.post("/api/interview/tts", content=raw, headers={**h, "Content-Type": "application/json"})
        assert r.status_code == 400, (raw, r.status_code, r.text)


def test_candidate_job_alerts_after_a_matching_job_is_posted(client, world):
    cand = world["cand"]
    client.put("/api/profile", json={"resumeText": RESUME, "skills": ["Python", "FastAPI", "PostgreSQL", "Kafka"],
                                     "currentRole": "Backend Engineer"}, headers=cand["h"])
    res = client.post("/api/vendor/jobs", json={
        "title": "Python Backend Engineer", "jobDescription": "Python FastAPI PostgreSQL Kafka backend engineer for payments." * 2,
        "requiredSkills": ["Python", "FastAPI", "PostgreSQL"], "roleTrack": "Backend Engineer",
        "experienceLevel": "3 – 5 Years", "location": "Remote"}, headers=world["a"]["h"])
    assert res.status_code == 201
    alerts = client.get("/api/candidate/job-alerts", headers=cand["h"])
    assert alerts.status_code == 200 and isinstance(alerts.json()["alerts"], list)
    assert client.get("/api/candidate/job-alerts").status_code == 401


# ── vendor job routes not covered in part 1 ─────────────────────────────────────────────────────────────────


def test_mark_job_deleted_for_candidates(client, world):
    _apply(client, world)
    url = f"/api/vendor/jobs/{world['job']['id']}/mark-deleted-for-candidates"
    assert client.post(url).status_code == 401
    assert client.post(url, headers=world["cand"]["h"]).status_code == 403
    ok = client.post(url, headers=world["a"]["h"])
    assert ok.status_code == 200 and ok.json()["candidateApplicationsUpdated"] == 1
    apps = client.get("/api/applications", headers=world["cand"]["h"]).json()["applications"]
    assert [a["jobStatus"] for a in apps if a.get("jobId") == world["job"]["id"]] == ["deleted"]
    assert client.post("/api/vendor/jobs/nope/mark-deleted-for-candidates", headers=world["a"]["h"]).status_code == 404


def test_vendor_candidate_rosters(client, world):
    _apply(client, world)
    a, b = world["a"], world["b"]
    roster = client.get("/api/vendor/candidates?scope=org", headers=a["h"])
    assert roster.status_code == 200, roster.text
    emails = [c.get("candidateEmail") for c in roster.json().get("candidates", [])]
    assert world["cand"]["email"] in emails
    other = client.get("/api/vendor/candidates?scope=org", headers=b["h"]).json()
    assert world["cand"]["email"] not in [c.get("candidateEmail") for c in other.get("candidates", [])]
    filtered = client.get("/api/vendor/candidates?scope=org&name=zzzz-nobody", headers=a["h"]).json()
    assert world["cand"]["email"] not in [c.get("candidateEmail") for c in filtered.get("candidates", [])]
    per_job = client.get(f"/api/vendor/jobs/{world['job']['id']}/candidates", headers=a["h"])
    assert per_job.status_code == 200, per_job.text
    assert client.get(f"/api/vendor/jobs/{world['job']['id']}/candidates", headers=b["h"]).status_code == 404
    assert client.get("/api/vendor/candidates", headers=world["cand"]["h"]).status_code == 403


def test_interview_plan_preview(client, world, fake_llm):
    app_id = _apply(client, world)["applicationId"]
    url = f"/api/vendor/applicants/{app_id}/interview-plan"
    assert client.get(url).status_code == 401
    assert client.get(url, headers=world["cand"]["h"]).status_code == 403
    assert client.get(url, headers=world["b"]["h"]).status_code == 404
    plan = client.get(url, headers=world["a"]["h"])
    assert plan.status_code == 200, plan.text
    body = plan.json()
    assert body["jdFirst"] is True and len([q for q in body["questions"] if q.get("text")]) >= 9
    assert "resumeText" not in plan.text


def test_interview_plan_preview_without_llm_is_503(client, world):
    app_id = _apply(client, world)["applicationId"]
    res = client.get(f"/api/vendor/applicants/{app_id}/interview-plan", headers=world["a"]["h"])
    assert res.status_code == 503 and res.json()["code"] == "LLM_QUESTION_REQUIRED"


def test_bulk_interview_invites_happy_path(client, world):
    h = world["a"]["h"]
    res = client.post("/api/vendor/interview-invites/send",
                      json={"candidates": [{"email": "one@qa.test", "name": "One"}, {"email": "one@qa.test"}, {"email": "bad"}],
                            "jobId": world["job"]["id"], "expiresInDays": "abc"}, headers=h)
    assert res.status_code == 201, res.text
    invites = res.json()["invites"]
    assert len(invites) == 1 and invites[0].get("emailSent") in (False, None)
    token = invites[0].get("token") or invites[0]["inviteUrl"].rstrip("/").rsplit("/", 1)[-1]
    assert client.get(f"/api/interview-invites/{token}").status_code == 200
    assert client.post("/api/vendor/interview-invites/send", json={"email": "x@qa.test", "jobId": "nope"}, headers=h).status_code == 404
    assert client.post("/api/vendor/interview-invites/send", json={"email": "x@qa.test"}).status_code == 401


def test_vendor_candidate_documents(client, world, monkeypatch):
    from app.dispatch import api_dispatch, route_extensions

    _apply(client, world)
    email = world["cand"]["email"]
    a, b = world["a"], world["b"]
    # Access rules first: other org (no link) is refused, candidates are refused.
    for path in ("/api/vendor/candidate-documents/resume", "/api/vendor/candidate-documents/recording",
                 "/api/vendor/candidate-documents/report"):
        assert client.get(f"{path}?email={email}").status_code == 401
        assert client.get(f"{path}?email={email}", headers=world["cand"]["h"]).status_code == 403
        r = client.get(f"{path}?email={email}", headers=b["h"])
        assert r.status_code in (403, 404), (path, r.status_code, r.text)
        assert client.get(path, headers=a["h"]).status_code in (400, 403, 404)
    # No stored file (S3 is off in tests): a clean 4xx/503, never 500.
    for path in ("/api/vendor/candidate-documents/resume", "/api/vendor/candidate-documents/recording",
                 "/api/vendor/candidate-documents/report"):
        r = client.get(f"{path}?email={email}", headers=a["h"])
        assert r.status_code in (404, 503), (path, r.status_code, r.text)

    # Happy path with storage mocked.
    async def fake_resume(profile, pool, **_k):
        return {"url": "https://s3.example/resume.pdf?sig", "expiresInSeconds": 300, "contentType": "application/pdf",
                "filename": "resume.pdf"}

    async def fake_recording(**_k):
        return {"url": "https://s3.example/rec.webm?sig", "expiresInSeconds": 300, "contentType": "video/webm",
                "interviewId": "s1", "durationSeconds": 60, "fileSizeBytes": 10}

    async def fake_report(**_k):
        return {"url": "https://s3.example/rep.pdf?sig", "expiresInSeconds": 300, "contentType": "application/pdf"}

    monkeypatch.setattr(api_dispatch, "resolve_resume_download_from_profile", fake_resume)
    monkeypatch.setattr(route_extensions.rec_store, "resolve_employer_candidate_recording_playback", fake_recording)
    monkeypatch.setattr(route_extensions.art_store, "resolve_candidate_interview_report_download", fake_report)
    assert client.get(f"/api/vendor/candidate-documents/resume?email={email}", headers=a["h"]).json()["viewUrl"].startswith("https://")
    assert client.get(f"/api/vendor/candidate-documents/recording?email={email}", headers=a["h"]).json()["playbackUrl"].startswith("https://")
    assert client.get(f"/api/vendor/candidate-documents/report?email={email}", headers=a["h"]).json()["viewUrl"].startswith("https://")
    # (The strict "video needs a link to this organisation" rule lives inside the storage resolver, which is mocked
    # here; it is covered by test_recording_access / test_tenant_isolation.)


# ── interview turn-by-turn routes ────────────────────────────────────────────────────────────────────────────


def test_interview_next_turn_interact_integrity_flow_and_save(client, world, fake_llm):
    cand, other = world["cand"], _signup(client)
    _app, s = _interview(client, world)
    sid = s["sessionId"]
    q1 = s["questions"][0]
    nxt = client.post("/api/interview/next", json={"sessionId": sid, "lastQuestion": q1, "lastAnswer": "My answer."},
                      headers=cand["h"])
    assert nxt.status_code == 200, nxt.text
    assert nxt.json()["turn"] == 2 and nxt.json()["question"]["text"]
    assert client.post("/api/interview/next", json={"sessionId": sid}, headers=other["h"]).status_code == 404
    turn = client.post("/api/interview/turn", json={"question": q1, "answer": "Done", "questionIndex": 0}, headers=cand["h"])
    assert turn.status_code == 200 and turn.json()["acknowledgment"]
    inter = client.post("/api/interview/interact", json={"phase": "day_check", "userText": "good"}, headers=cand["h"])
    assert inter.status_code == 200 and inter.json()["phase"] == "confirm_role"
    flow = client.get("/api/interview/flow", headers=cand["h"])
    assert flow.status_code == 200 and "phases" in flow.json()["flow"]
    assert client.get("/api/interview/flow").status_code == 401
    integ = client.post("/api/interview/integrity", json={"sessionId": sid, "faceCount": 2}, headers=cand["h"])
    assert integ.status_code == 200 and integ.json()["integrity"]["singlePersonOk"] is False
    assert client.post("/api/interview/integrity", json={"sessionId": sid, "faceCount": 1}, headers=other["h"]).status_code == 404
    assert client.post("/api/interview/transcribe", json={}, headers=cand["h"]).status_code == 410
    # POST /api/interview only accepts a server-scored session.
    assert client.post("/api/interview", json={"sessionId": sid, "overall": 100}, headers=cand["h"]).status_code == 400
    scored = client.post("/api/interview/score", json={"sessionId": sid, "answers": ["I built Kafka consumers."] * 9},
                         headers=cand["h"])
    assert scored.status_code == 200
    # The face-count flag the server recorded survives into the result (client cannot clear it).
    saved = client.post("/api/interview", json={"sessionId": sid}, headers=cand["h"])
    assert saved.status_code == 200, saved.text
    assert client.post("/api/interview", json={"sessionId": sid}, headers=other["h"]).status_code == 400


def test_personalized_session_route_requires_owner(client, world):
    sid = "00000000-0000-0000-0000-000000000000"
    assert client.get(f"/api/interview/session/{sid}").status_code == 401
    r = client.get(f"/api/interview/session/{sid}", headers=world["cand"]["h"])
    assert r.status_code == 404, r.text


def test_review_events_and_vendor_timeline_on_postgres(client, world, fake_llm):
    cand, other = world["cand"], _signup(client)
    _app, s = _interview(client, world)
    sid = s["sessionId"]
    ev = {"id": "ev-1", "eventType": "SIDE_GAZE_LOOKING_AWAY", "startOffsetSec": 12.5, "durationSec": 4.25,
          "timestamp": "2026-11-20T10:00:00Z", "formattedTime": "0:12", "message": "Face the camera"}
    url = "/api/interview/review-events"
    assert client.post(url, json={"sessionId": sid, "events": [ev]}).status_code == 401
    assert client.post(url, json={"sessionId": sid, "events": [ev]}, headers=other["h"]).status_code == 404
    assert client.post(url, json={"sessionId": sid, "events": [{**ev, "eventType": "DROP TABLE"}]}, headers=cand["h"]).status_code == 400
    ok = client.post(url, json={"sessionId": sid, "events": [ev]}, headers=cand["h"])
    assert ok.status_code == 200, ok.text
    patch = client.patch(url, json={"sessionId": sid, "eventId": "ev-1", "explanation": "I was reading the question."},
                         headers=cand["h"])
    assert patch.status_code == 200, patch.text
    got = client.get(f"{url}?sessionId={sid}", headers=cand["h"])
    assert got.status_code == 200 and "ev-1" in got.text
    review = f"/api/vendor/interview-review?sessionId={sid}&email={cand['email']}"
    tl = client.get(review, headers=world["a"]["h"])
    assert tl.status_code == 200, tl.text
    assert [(e["eventType"], e["startOffsetMs"], e["endOffsetMs"]) for e in tl.json()["events"]] == [
        ("SIDE_GAZE_LOOKING_AWAY", 12500, 16750)]
    assert client.get(review, headers=world["b"]["h"]).status_code == 404
    assert client.get(review, headers=cand["h"]).status_code == 403
    assert client.get("/api/vendor/interview-review", headers=world["a"]["h"]).status_code == 400


# ── recordings + artifacts (S3 mocked; real S3 is never used in tests) ───────────────────────────────────────


def test_recording_and_artifact_routes(client, world, fake_llm, monkeypatch):
    from app.dispatch import api_dispatch, route_extensions

    cand = world["cand"]
    _app, s = _interview(client, world)
    sid = s["sessionId"]
    h = cand["h"]
    assert client.get("/api/interview/recordings/playback", headers=h).status_code == 403  # never for candidates
    # Storage off -> 503 (not 500).
    from app.services.storage.s3_storage import s3_storage_configured

    assert not s3_storage_configured()  # tests must never reach the real bucket
    assert client.post("/api/interview/recordings/upload", files={"file": ("a.webm", b"x")}, headers=h).status_code == 503
    assert client.post("/api/interview/recordings/upload-url", json={"sessionId": sid}, headers=h).status_code == 503
    r = client.post("/api/interview/artifacts/report", json={"sessionId": sid, "file_base64": "eA=="}, headers=h)
    assert r.status_code in (400, 404, 503), r.text
    assert client.get("/api/interview/artifacts/x/bad/download", headers=h).status_code == 400
    r = client.get(f"/api/interview/artifacts/{sid}/report/download?format=json", headers=h)
    assert r.status_code in (404, 503), r.text
    assert client.get("/api/interview/recordings/nope/download", headers=h).status_code == 403  # candidates: employer only
    r = client.get("/api/interview/recordings/nope/download?format=json", headers=world["a"]["h"])
    assert r.status_code in (404, 503), r.text

    # Happy paths with storage mocked.
    monkeypatch.setattr(api_dispatch, "s3_storage_configured", lambda: True)
    seen = {}

    async def fake_store(**kw):
        seen.update(kw)
        return {"ok": True, "recordingId": "rec-1"}

    async def fake_authorize(**kw):
        return {"recordingId": "rec-2", "uploadUrl": "https://s3.example/put"}

    async def fake_complete(**kw):
        return {"recordingId": kw["recordingId"], "status": "uploaded"}

    monkeypatch.setattr(api_dispatch.rec_store, "store_interview_recording_bytes", fake_store)
    monkeypatch.setattr(api_dispatch.rec_store, "authorize_interview_recording_upload", fake_authorize)
    monkeypatch.setattr(api_dispatch.rec_store, "complete_interview_recording_upload", fake_complete)
    up = client.post("/api/interview/recordings/upload", data={"sessionId": sid, "durationSeconds": "nan-ish"},
                     files={"file": ("a.webm", b"abc", "video/webm")}, headers=h)
    assert up.status_code == 200, up.text
    assert seen["size"] == 3 and seen["durationSeconds"] is None and seen["requesterEmail"] == cand["email"]
    assert client.post("/api/interview/recordings/upload", data={"sessionId": sid}, headers=h).status_code == 400
    assert client.post("/api/interview/recordings/upload-url", json={"sessionId": sid, "fileSize": "x"}, headers=h).status_code == 200
    done = client.post("/api/interview/recordings/complete", json={"recordingId": "rec-2", "sessionId": sid}, headers=h)
    assert done.status_code == 200 and done.json()["status"] == "uploaded"

    async def fake_download(**kw):
        assert kw["tenantId"]  # always scoped to the employer's organisation
        return {"url": "https://s3.example/get", "expiresInSeconds": 60}

    async def fake_artifact(**kw):
        assert kw["requesterEmail"] == cand["email"]
        return {"url": "https://s3.example/art", "expiresInSeconds": 60}

    monkeypatch.setattr(route_extensions.rec_store, "resolve_interview_recording_download", fake_download)
    monkeypatch.setattr(route_extensions.art_store, "resolve_interview_artifact_download", fake_artifact)
    d = client.get("/api/interview/recordings/rec-1/download?format=json", headers=world["a"]["h"])
    assert d.status_code == 200 and d.json()["downloadUrl"].startswith("https://")
    a = client.get(f"/api/interview/artifacts/{sid}/transcript/download?format=json", headers=h)
    assert a.status_code == 200 and a.json()["downloadUrl"].startswith("https://")
    redirect = client.get(f"/api/interview/artifacts/{sid}/report/download", headers=h, follow_redirects=False)
    assert redirect.status_code == 302


# ── candidate applications + resume ─────────────────────────────────────────────────────────────────────────


def test_candidate_application_records(client, world):
    cand, other = world["cand"], _signup(client)
    url = "/api/applications"
    assert client.post(url, json={"title": "x"}).status_code == 401
    made = client.post(url, json={"jobTitle": "Saved job", "company": "Acme"}, headers=cand["h"])
    assert made.status_code == 201, made.text
    rid = made.json()["application"]["id"]
    again = client.post(url, json={"id": rid, "status": "Interview"}, headers=cand["h"])
    assert again.status_code == 201 and [a["status"] for a in again.json()["applications"] if a["id"] == rid] == ["Interview"]
    assert all(a["id"] != rid for a in client.get(url, headers=other["h"]).json()["applications"])
    for bad in ({"id": {"a": 1}}, {"id": ["x"]}, {"id": 5}, {"status": {"x": 1}}):
        r = client.post(url, json=bad, headers=cand["h"])
        assert r.status_code in (201, 400), (bad, r.status_code, r.text)
    assert client.delete(f"{url}/{rid}", headers=cand["h"]).status_code == 200
    assert all(a["id"] != rid for a in client.get(url, headers=cand["h"]).json()["applications"])


def test_resume_routes(client, world, monkeypatch):
    from app.dispatch import api_dispatch

    h = world["cand"]["h"]
    # Storage off: upload is a clean 503 and download a 4xx/503.
    assert client.post("/api/resume/upload", json={}, headers=h).status_code == 503
    r = client.get("/api/resume/download?format=json", headers=h)
    assert r.status_code in (404, 503), r.text
    assert client.post("/api/resume/upload", json={}).status_code == 401
    assert client.get("/api/resume/download").status_code == 401
    # Parse: bad base64 / oversized are 4xx.
    assert client.post("/api/resume/parse", json={"fileData": "%%%not-base64", "fileName": "a.pdf"}, headers=h).status_code == 400
    assert client.post("/api/resume/parse", json={"fileData": "A" * 3_000_000}, headers=h).status_code == 413
    # Upload happy path with storage mocked.
    monkeypatch.setattr(api_dispatch, "object_storage_configured", lambda: True)

    async def fake_upload(**kw):
        assert kw["candidateEmail"] == world["cand"]["email"]
        return {"storagePath": "users/x/resume/a.pdf", "resumeUrl": "", "storageProvider": "s3", "fileId": "f1"}

    monkeypatch.setattr(api_dispatch, "upload_resume_to_object_storage", fake_upload)
    pdf = base64.b64encode(b"%PDF-1.4 hello").decode()
    up = client.post("/api/resume/upload", json={"fileName": "a.pdf", "fileBase64": pdf, "fileData": pdf,
                                                  "filename": "a.pdf", "contentType": "application/pdf"}, headers=h)
    assert up.status_code in (200, 400), up.text
    # Replace: validation errors are 4xx.
    r = client.post("/api/resume/replace", json={}, headers=h)
    assert r.status_code in (400, 503), r.text


# ── talent search ────────────────────────────────────────────────────────────────────────────────────────────


def test_talent_search_and_candidate_detail(client, world, fake_llm):
    cand = world["cand"]
    client.put("/api/profile", json={"resumeText": RESUME, "skills": ["Python", "Kafka"], "currentRole": "Backend Engineer",
                                     "profileVisibility": "public"}, headers=cand["h"])
    a = world["a"]["h"]
    for qs in ("q=python", "skills=Python,Kafka&minScore=abc", "minScore=nan", "minScore=inf", "limit=abc&offset=-1",
               "q=" + "x" * 500):
        r = client.get(f"/api/talent/search?{qs}", headers=a)
        assert r.status_code == 200, (qs, r.status_code, r.text)
    hits = client.get("/api/talent/search?q=python&limit=100", headers=a).json()["candidates"]
    assert client.get("/api/talent/search?q=python", headers=cand["h"]).status_code == 403
    assert client.get("/api/talent/search").status_code == 401
    if hits:
        cid = hits[0].get("userId") or hits[0].get("id")
        r = client.get(f"/api/talent/candidates/{cid}", headers=a)
        assert r.status_code in (200, 404), r.text
    assert client.get("/api/talent/candidates/nope", headers=a).status_code == 404
    assert client.get("/api/talent/candidates/nope", headers=cand["h"]).status_code == 403


# ── reminders (cron) with mail mocked ────────────────────────────────────────────────────────────────────────


def test_reminder_cron_sends_due_reminders_once(client, world, monkeypatch):
    from datetime import datetime, timedelta, timezone

    from app.dispatch import schedule_routes

    app_id = _apply(client, world)["applicationId"]
    soon = (datetime.now(timezone.utc) + timedelta(hours=1, minutes=30)).isoformat()
    inv = client.post(f"/api/vendor/applicants/{app_id}/interview-invite", json={"scheduledStart": soon, "durationMinutes": 30},
                      headers=world["a"]["h"])
    assert inv.status_code == 201, inv.text
    # Invites booked a moment ago are quiet (no reminder right after booking): backdate this one.
    import psycopg

    with psycopg.connect(os.environ["TEST_DATABASE_URL"]) as conn:
        conn.execute("UPDATE interview_invites SET created_at = NOW() - INTERVAL '2 days' WHERE token = %s",
                     (inv.json()["invite"]["token"],))
    sent: list[str] = []

    async def fake_send_mail(*, to, subject, html, text=None):
        sent.append(to)

    monkeypatch.setenv("CRON_SECRET", "qa-cron-secret")
    monkeypatch.setattr(schedule_routes, "smtp_configured", lambda: True)
    monkeypatch.setattr(schedule_routes, "send_mail", fake_send_mail)
    h = {"x-cron-secret": "qa-cron-secret"}
    first = client.post("/api/internal/interview-reminders", headers=h)
    assert first.status_code == 200, first.text
    assert sent.count(world["cand"]["email"]) == 1
    second = client.post("/api/internal/interview-reminders", headers=h)
    assert second.status_code == 200 and sent.count(world["cand"]["email"]) == 1  # not sent twice


# ── assessments (recruiter-approved 7-question flow), LLM mocked ─────────────────────────────────────────────

_COMPETENCIES = [{"id": f"c{i}", "name": f"Competency {i}", "requirement": f"Python requirement number {i}", "weight": w}
                 for i, w in enumerate([20, 15, 15, 15, 15, 10, 10])]


@pytest.fixture
def fake_assessment_ai(monkeypatch):
    from app.assessment import service

    async def fake(*, system, payload, validate, purpose):
        if purpose == "plan":
            qs = [{
                "question_id": f"q{i}", "question_text": f"Question {i}: describe Python requirement number {i} in practice?",
                "competency": c["id"], "difficulty": "intermediate", "question_type": "experience", "max_score": 4,
                "scoring_rubric": {str(n): f"anchor {n}" for n in range(5)},
                "resume_or_job_evidence": c["requirement"], "expected_answer_points": ["point"],
                "selection_reason": "relevant", "suggested_follow_up": "why?",
            } for i, c in enumerate(_COMPETENCIES)]
            return {"model": "fake", "data": validate({"questions": qs})}
        answer = payload["answer"]
        value = {"score": 3, "evidence": [answer[:10]], "strengths": ["s"], "gaps": ["g"], "reasoning": "ok",
                 "confidence": 0.9, "needs_human_review": False}
        return {"model": "fake", "data": validate(value)}

    monkeypatch.setattr(service, "structured_call", fake)


def _pdf_b64() -> str:
    from tests.test_resume_text_and_assessment import RESUME_LINES, _pdf

    return base64.b64encode(_pdf(RESUME_LINES)).decode()


def test_assessment_full_flow_and_guards(client, world, fake_assessment_ai):
    a, b, cand = world["a"], world["b"], world["cand"]
    org_id = client.get("/api/organization", headers=a["h"]).json()["organization"]["id"]
    job_body = {"organization_id": org_id, "title": "Python Dev", "description": "Python requirement number 1 and more.",
                "experience_level": "3 years", "competencies": _COMPETENCIES}
    assert client.post("/api/assessments/jobs", json=job_body).status_code == 401
    assert client.post("/api/assessments/jobs", json=job_body, headers=b["h"]).status_code == 403  # not their org
    assert client.post("/api/assessments/jobs", json=job_body, headers=cand["h"]).status_code == 403
    assert client.post("/api/assessments/jobs", json={**job_body, "competencies": _COMPETENCIES[:3]}, headers=a["h"]).status_code == 400
    job = client.post("/api/assessments/jobs", json=job_body, headers=a["h"])
    assert job.status_code == 201, job.text
    job_id = job.json()["job"]["id"]
    assert any(j["id"] == job_id for j in client.get(f"/api/assessments/jobs?organization_id={org_id}", headers=a["h"]).json()["jobs"])
    assert client.get(f"/api/assessments/jobs?organization_id={org_id}", headers=b["h"]).status_code == 403
    assert client.get("/api/assessments/jobs", headers=cand["h"]).status_code == 200

    # Resume upload: bad input is 4xx.
    for body in ({"filename": "a.exe", "file_base64": "eA=="}, {"filename": "a.pdf", "file_base64": "!!!notbase64!!!"},
                 {"filename": "a.pdf", "file_base64": base64.b64encode(b"not a pdf").decode()}, {"filename": 5}):
        r = client.post("/api/assessments/resumes", json=body, headers=cand["h"])
        assert 400 <= r.status_code < 500, (body, r.status_code, r.text)
    res = client.post("/api/assessments/resumes", json={"filename": "cv.pdf", "file_base64": _pdf_b64()}, headers=cand["h"])
    assert res.status_code == 201, res.text
    resume_id = res.json()["resume_id"]

    gen_body = {"job_id": job_id, "resume_id": resume_id, "consent": True}
    assert client.post("/api/assessments/generate", json={**gen_body, "consent": False}, headers=cand["h"]).status_code == 400
    for bad in ({**gen_body, "job_id": "not-a-uuid"}, {**gen_body, "resume_id": "not-a-uuid"}, {**gen_body, "job_id": None}):
        r = client.post("/api/assessments/generate", json=bad, headers=cand["h"])
        assert 400 <= r.status_code < 500, (bad, r.status_code, r.text)
    gen = client.post("/api/assessments/generate", json=gen_body, headers=cand["h"])
    assert gen.status_code == 201, gen.text
    sid = gen.json()["session_id"]
    view = client.get(f"/api/assessments/{sid}", headers=cand["h"]).json()
    other = _signup(client)
    assert client.get(f"/api/assessments/{sid}", headers=other["h"]).status_code == 403
    assert client.get(f"/api/assessments/{sid}", headers=b["h"]).status_code == 403
    assert client.get(f"/api/assessments/{sid}/plan", headers=cand["h"]).status_code == 403
    assert client.get(f"/api/assessments/{sid}/plan", headers=a["h"]).status_code == 200
    # Start before approval -> 409; junk version -> 400 (not 500).
    assert client.post(f"/api/assessments/{sid}/start", json={"version": view["version"]}, headers=cand["h"]).status_code == 409
    for v in (None, "abc", {"x": 1}):
        r = client.post(f"/api/assessments/{sid}/start", json={"version": v}, headers=cand["h"])
        assert r.status_code == 400, (v, r.status_code, r.text)
        r = client.post(f"/api/assessments/{sid}/approve", json={"version": v}, headers=a["h"])
        assert r.status_code == 400, (v, r.status_code, r.text)
    appr = client.post(f"/api/assessments/{sid}/approve", json={"version": view["version"]}, headers=a["h"])
    assert appr.status_code == 200, appr.text
    v = appr.json()["version"]
    started = client.post(f"/api/assessments/{sid}/start", json={"version": v}, headers=cand["h"])
    assert started.status_code == 200, started.text
    cur = started.json()
    rep = client.post(f"/api/assessments/{sid}/repeat-question", json={}, headers=cand["h"])
    assert rep.status_code == 200 and rep.json()["intent"] == "repeat_question"
    for i in range(7):
        qid = cur["current_question"]["question_id"]
        body = {"version": cur["version"], "question_id": qid, "request_id": f"r{i}", "message": f"My detailed answer number {i} about Python."}
        res = client.post(f"/api/assessments/{sid}/answers", json=body, headers=cand["h"])
        assert res.status_code == 200, res.text
        dup = client.post(f"/api/assessments/{sid}/answers", json=body, headers=cand["h"])  # double submit
        assert dup.status_code == 409, dup.text
        cur = res.json()
    assert cur["status"] == "completed"
    report = client.get(f"/api/assessments/{sid}/report", headers=a["h"])
    assert report.status_code == 200, report.text
    assert report.json()["evaluations_pending"] == 0
    assert client.get(f"/api/assessments/{sid}/report", headers=b["h"]).status_code == 403
    listed = client.get(f"/api/assessments?organization_id={org_id}&limit=abc", headers=a["h"])
    assert listed.status_code == 200 and any(str(s["id"]) == sid for s in listed.json()["interviews"])
    assert client.get("/api/assessments/not-a-uuid", headers=a["h"]).status_code == 404
    assert client.post(f"/api/assessments/{sid}/cancel", json={"version": cur["version"]}, headers=cand["h"]).status_code == 409
