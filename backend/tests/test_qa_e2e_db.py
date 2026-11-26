"""End-to-end product flows over HTTP against a real throwaway Postgres (backend QA).

Candidate signup -> resume parse (name from resume) -> apply via job link -> JD-first interview -> score ->
report visible to the candidate and to the job's organisation -> ranked applicant list; plus auth / role / tenant
isolation / invalid input / idempotency checks on the same routes. The LLM is always mocked.
Skipped without TEST_DATABASE_URL.
"""

from __future__ import annotations

import json
import os
import secrets
import threading

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not set")

JD = """Backend Engineer - Payments

Responsibilities:
- Design and maintain REST APIs for the payments ledger in Python and FastAPI.
- Own PostgreSQL schema changes and query performance for high-volume tables.
- Build event pipelines on Kafka for settlement and reconciliation.
- Collaborate with product and finance teams to ship features safely.

Requirements:
- 3+ years with Python, FastAPI, PostgreSQL, Kafka, Docker.
"""

RESUME = """Priya Natarajan
Backend Engineer | priya.n@example.com | +91 98765 43210

Experience
Software Engineer, Acme Fintech (2021 - Present)
- Built Python and FastAPI REST services for card payouts on PostgreSQL.
- Ran Kafka consumers for settlement events; containerised services with Docker.

Skills: Python, FastAPI, PostgreSQL, Kafka, Docker, Redis
"""

CONSENT = {"recording": True, "faceTracking": True, "aiScoring": True, "version": "2026-01"}


def _phone() -> str:
    return "+91" + "9" + "".join(secrets.choice("0123456789") for _ in range(9))


def _signup(client, *, role="jobseeker", name="Test User", company=None):
    email = f"{role[:3]}-{secrets.token_hex(5)}@qa.test"
    body = {"name": name, "email": email, "password": "Passw0rd!x", "phone": _phone(), "role": role}
    if company:
        body["companyName"] = company
    res = client.post("/api/signup", json=body)
    assert res.status_code == 201, res.text
    data = res.json()
    return {"email": email, "token": data["token"], "user": data["user"], "h": {"Authorization": f"Bearer {data['token']}"}}


def _job_body(**over):
    body = {
        "title": "Backend Engineer - Payments",
        "jobDescription": JD,
        "requiredSkills": ["Python", "FastAPI", "PostgreSQL", "Kafka", "Docker"],
        "roleTrack": "Backend Engineer",
        "experienceLevel": "3 – 5 Years",
        "location": "Bengaluru",
    }
    body.update(over)
    return body


@pytest.fixture(autouse=True)
def _fresh_rate_limits():
    from app.server import ratelimit

    ratelimit.reset_for_tests()
    yield
    ratelimit.reset_for_tests()


@pytest.fixture
def fake_llm(monkeypatch):
    """Question generation goes through the real JD-first planner; only the model call is faked."""
    from app.services import interview_llm_questions as qmod

    calls: list[dict] = []
    angles = ["for the payments ledger", "under audit rules", "with traffic spikes", "during a migration freeze",
              "with flaky downstream banks", "for multi-region failover", "while keeping costs predictable",
              "for nightly reconciliation", "for merchant onboarding", "with strict latency budgets"]

    async def fake(system: str, user: str, *, temperature: float, max_tokens: int = 2048) -> str:
        payload = json.loads(user)
        calls.append(payload)
        out = []
        for t in payload.get("turns") or []:
            slot, target, n = t.get("slot"), t.get("target") or "the role", t["turnNumber"]
            angle = angles[n % len(angles)]
            if slot == "behavioural":
                text = f"Tell me about a time a release you owned slipped {angle}. What did you do and what changed?"
            elif slot == "jd-alignment":
                text = (f"At Acme Fintech you built Python payout services on PostgreSQL. How does that work prepare "
                        f"you for {target} on this payments ledger {angle}?")
            else:
                text = f"How would you approach {target} on the payments ledger {angle}, and what trade-offs matter?"
            out.append({"turnNumber": n, "question": {"text": text, "category": "Technical"}})
        return json.dumps({"questions": out})

    monkeypatch.setattr(qmod, "_gemini_generate", fake)
    monkeypatch.setattr("app.services.interview_api.llm_configured", lambda: True)
    return calls


@pytest.fixture
def world(client):
    """Two organisations with one job each, and a candidate."""
    org_a = _signup(client, role="employer", name="Rita Recruiter", company=f"Acme {secrets.token_hex(3)}")
    org_b = _signup(client, role="employer", name="Bob Boss", company=f"Other {secrets.token_hex(3)}")
    res = client.post("/api/vendor/jobs", json=_job_body(), headers=org_a["h"])
    assert res.status_code == 201, res.text
    job = res.json()["job"]
    cand = _signup(client, name="Signup Name")
    return {"a": org_a, "b": org_b, "job": job, "cand": cand}


# ── Auth / roles on the main routes ──────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/api/me"),
        ("GET", "/api/jobs"),
        ("GET", "/api/applications"),
        ("GET", "/api/candidate/job-alerts"),
        ("GET", "/api/vendor/jobs"),
        ("POST", "/api/vendor/jobs"),
        ("GET", "/api/vendor/candidates"),
        ("GET", "/api/vendor/application-alerts"),
        ("GET", "/api/vendor/jobs/x/applicants"),
        ("POST", "/api/interview/start"),
        ("POST", "/api/interview/score"),
        ("GET", "/api/payments/retake/status"),
        ("POST", "/api/payments/retake/order"),
        ("GET", "/api/confidential/candidates"),
        ("GET", "/api/confidential/stats"),
        ("GET", "/api/talent/search"),
        ("GET", "/api/organization"),
        ("POST", "/api/resume/replace"),
        ("POST", "/api/interview/review-events"),
        ("POST", "/api/interview-invites/abc/reschedule"),
    ],
)
def test_protected_routes_refuse_anonymous_requests(client, method, path):
    res = client.request(method, path, json={} if method != "GET" else None)
    assert res.status_code == 401, (path, res.status_code, res.text)
    bad = client.request(method, path, json={} if method != "GET" else None, headers={"Authorization": "Bearer nope"})
    assert bad.status_code == 401, (path, bad.status_code, bad.text)


def test_candidates_cannot_use_vendor_routes_and_vendors_cannot_apply(client, world):
    cand, job = world["cand"], world["job"]
    for method, path in [
        ("GET", "/api/vendor/jobs"),
        ("POST", "/api/vendor/jobs"),
        ("GET", "/api/vendor/candidates"),
        ("GET", f"/api/vendor/jobs/{job['id']}/applicants"),
        ("GET", "/api/confidential/candidates"),
    ]:
        res = client.request(method, path, json=_job_body() if method == "POST" else None, headers=cand["h"])
        assert res.status_code == 403, (path, res.status_code, res.text)
    res = client.post(f"/api/jobs/public/{job['shareableCode']}/apply", json={"resumeText": RESUME}, headers=world["a"]["h"])
    assert res.status_code == 403
    alerts = client.get("/api/candidate/job-alerts", headers=world["a"]["h"])
    assert alerts.status_code == 403


def test_vendor_job_validation_is_400_not_500(client, world):
    h = world["a"]["h"]
    for body in (
        _job_body(title=""),
        _job_body(jobDescription="too short"),
        _job_body(roleTrack=""),
        _job_body(experienceLevel=""),
        _job_body(location=""),
        _job_body(requiredSkills=["x" * 101]),
        _job_body(requiredSkills=[f"s{i}" for i in range(41)]),
    ):
        res = client.post("/api/vendor/jobs", json=body, headers=h)
        assert res.status_code == 400, (body, res.status_code, res.text)
    for raw in ("not json", "[1,2]", "null"):
        res = client.post("/api/vendor/jobs", content=raw, headers={**h, "Content-Type": "application/json"})
        assert res.status_code == 400, (raw, res.status_code)


def test_signup_and_login_validation(client):
    ok = {"name": "N", "email": f"v-{secrets.token_hex(4)}@qa.test", "password": "Passw0rd!x", "phone": _phone()}
    for patch in ({"email": "bad"}, {"password": "short"}, {"phone": "12"}, {"name": ""}, {"email": "a@b.c" + "x" * 300}):
        assert client.post("/api/signup", json={**ok, **patch}).status_code == 400, patch
    assert client.post("/api/signup", json={**ok, "role": "employer"}).status_code == 400  # no company
    assert client.post("/api/signup", json=[1, 2]).status_code in (400, 422)
    assert client.post("/api/signup", json=ok).status_code == 201
    dup = client.post("/api/signup", json={**ok, "phone": _phone()})
    assert dup.status_code == 409
    dup_phone = client.post("/api/signup", json={**ok, "email": f"w-{secrets.token_hex(4)}@qa.test"})
    assert dup_phone.status_code == 409
    assert client.post("/api/login", json={"email": ok["email"], "password": "wrong-pass"}).status_code == 401
    good = client.post("/api/login", json={"email": ok["email"].upper(), "password": ok["password"]})
    assert good.status_code == 200
    assert "passwordHash" not in json.dumps(good.json())
    wrong_role = client.post("/api/login", json={**ok, "expectedRole": "employer"})
    assert wrong_role.status_code == 403
    me = client.get("/api/me", headers={"Authorization": f"Bearer {good.json()['token']}"})
    assert me.status_code == 200 and "passwordHash" not in me.text and "password_hash" not in me.text


def test_logout_revokes_the_token(client):
    u = _signup(client)
    assert client.get("/api/me", headers=u["h"]).status_code == 200
    assert client.post("/api/logout", headers=u["h"]).status_code == 200
    assert client.get("/api/me", headers=u["h"]).status_code == 401


def test_parallel_logins_all_succeed(client):
    """20 parallel sign-ins from different accounts: no 500s, every one gets its own token."""
    users = [_signup(client) for _ in range(20)]
    results: list[int] = []
    tokens: list[str] = []
    barrier = threading.Barrier(len(users))

    def go(u):
        barrier.wait()
        r = client.post("/api/login", json={"email": u["email"], "password": "Passw0rd!x"})
        results.append(r.status_code)
        if r.status_code == 200:
            tokens.append(r.json()["token"])

    threads = [threading.Thread(target=go, args=(u,)) for u in users]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert results.count(200) == 20, results
    assert len(set(tokens)) == 20


def test_oversized_body_is_413(client, world):
    big = "x" * (12 * 1024 * 1024)
    res = client.post("/api/vendor/jobs", content=big, headers={**world["a"]["h"], "Content-Type": "application/json"})
    assert res.status_code == 413


# ── Public job link + apply ──────────────────────────────────────────────────────────────────────────────────


def test_public_job_link_and_apply_flow(client, world):
    cand, job = world["cand"], world["job"]
    code = job["shareableCode"]
    pub = client.get(f"/api/jobs/public/{code}")
    assert pub.status_code == 200 and pub.json()["job"]["id"] == job["id"]
    assert "createdByEmail" not in pub.text and "createdByUserId" not in pub.text
    assert client.get("/api/jobs/public/nope-not-a-code").status_code == 404
    assert client.post("/api/jobs/public/nope/apply", json={"resumeText": RESUME}, headers=cand["h"]).status_code == 404
    # Anonymous apply -> 401; short resume -> 400; a different email in the body -> 403.
    assert client.post(f"/api/jobs/public/{code}/apply", json={"resumeText": RESUME}).status_code == 401
    assert client.post(f"/api/jobs/public/{code}/apply", json={"resumeText": "tiny"}, headers=cand["h"]).status_code == 400
    spoof = client.post(
        f"/api/jobs/public/{code}/apply", json={"resumeText": RESUME, "candidateEmail": "x@y.z"}, headers=cand["h"]
    )
    assert spoof.status_code == 403
    first = client.post(f"/api/jobs/public/{code}/apply", json={"resumeText": RESUME}, headers=cand["h"])
    assert first.status_code == 201, first.text
    again = client.post(f"/api/jobs/public/{code}/apply", json={"resumeText": RESUME}, headers=cand["h"])
    assert again.status_code == 200 and again.json()["applicationId"] == first.json()["applicationId"]
    apps = client.get("/api/applications", headers=cand["h"]).json()
    assert len([a for a in apps["applications"] if a.get("jobId") == job["id"]]) == 1


def test_parallel_double_apply_creates_one_application(client, world):
    cand, job = world["cand"], world["job"]
    code = job["shareableCode"]
    codes: list[int] = []
    ids: list[str] = []
    barrier = threading.Barrier(6)

    def go():
        barrier.wait()
        r = client.post(f"/api/jobs/public/{code}/apply", json={"resumeText": RESUME}, headers=cand["h"])
        codes.append(r.status_code)
        if r.status_code in (200, 201):
            ids.append(r.json()["applicationId"])

    threads = [threading.Thread(target=go) for _ in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert all(c in (200, 201) for c in codes), codes
    assert len(set(ids)) == 1, ids
    listed = client.get(f"/api/vendor/jobs/{job['id']}/applicants", headers=world["a"]["h"]).json()
    assert listed["total"] == 1


# ── Full candidate journey ───────────────────────────────────────────────────────────────────────────────────


def _apply(client, world, cand=None):
    cand = cand or world["cand"]
    res = client.post(f"/api/jobs/public/{world['job']['shareableCode']}/apply", json={"resumeText": RESUME}, headers=cand["h"])
    assert res.status_code in (200, 201), res.text
    return res.json()


def test_full_journey_resume_apply_interview_score_report_ranking(client, world, fake_llm):
    cand, job, org_a, org_b = world["cand"], world["job"], world["a"], world["b"]
    # Resume parse (no AI configured in tests: honest fallback extract) keeps the name from the resume.
    parsed = client.post("/api/resume/parse", json={"text": RESUME}, headers=cand["h"])
    assert parsed.status_code == 200, parsed.text
    assert parsed.json()["extract"]["fullName"] == "Priya Natarajan"
    prof = client.put(
        "/api/profile",
        json={"fullName": "Someone Else", "resumeText": RESUME, "currentRole": "Backend Engineer",
              "totalExperience": "3 – 5 Years", "skills": ["Python", "FastAPI", "PostgreSQL", "Kafka", "Docker"]},
        headers=cand["h"],
    )
    assert prof.status_code == 200, prof.text
    assert prof.json()["profile"]["fullName"] == "Priya Natarajan"  # name comes from the resume

    applied = _apply(client, world)
    app_id = applied["applicationId"]

    # Consent is required.
    no_consent = client.post("/api/interview/start", json={"applicationId": app_id}, headers=cand["h"])
    assert no_consent.status_code == 400 and no_consent.json()["code"] == "CONSENT_REQUIRED"
    # Another candidate cannot start an interview on this application.
    other = _signup(client)
    stolen = client.post("/api/interview/start", json={"applicationId": app_id, "consent": CONSENT}, headers=other["h"])
    assert stolen.status_code in (403, 404), stolen.text

    start = client.post(
        "/api/interview/start", json={"applicationId": app_id, "jobId": job["id"], "consent": CONSENT}, headers=cand["h"]
    )
    assert start.status_code == 200, start.text
    s = start.json()
    assert s["jdFirst"] is True and s["durationMinutes"] == 20
    scored = [q for q in s["questions"] if q.get("text") and q.get("focus") not in ("structured-closing", "pending-closing")]
    slots = [q.get("slot") or q.get("jdSlot") for q in scored]
    assert len(scored) >= 9, [q.get("focus") for q in s["questions"]]
    if any(slots):
        assert slots.count("jd") == 6 and slots.count("jd-alignment") == 2 and slots.count("behavioural") == 1, slots
    sid = s["sessionId"]

    # Another candidate cannot score / read this session.
    assert client.post("/api/interview/score", json={"sessionId": sid, "answers": ["x"]}, headers=other["h"]).status_code == 404
    assert client.get(f"/api/interview/review-events?sessionId={sid}", headers=other["h"]).status_code == 404
    # Bad input
    assert client.post("/api/interview/score", json={"sessionId": sid, "answers": []}, headers=cand["h"]).status_code == 400

    answer = ("I designed idempotent FastAPI endpoints backed by PostgreSQL with unique keys, used Kafka consumer groups "
              "with retries and a dead letter topic, measured p95 latency, and wrote integration tests in Docker.")
    res = client.post("/api/interview/score", json={"sessionId": sid, "answers": [answer] * len(s["questions"])},
                      headers=cand["h"])
    assert res.status_code == 200, res.text
    result = res.json()["interview"]
    again = client.post("/api/interview/score", json={"sessionId": sid, "answers": ["changed"] * 9}, headers=cand["h"])
    assert again.status_code == 200 and again.json().get("alreadyScored") is True
    assert again.json()["interview"].get("overallScore") == result.get("overallScore")

    # The job's organisation sees the ranked applicant with the interview score; the other org sees nothing.
    listed = client.get(f"/api/vendor/jobs/{job['id']}/applicants", headers=org_a["h"])
    assert listed.status_code == 200, listed.text
    applicants = listed.json()["applicants"]
    assert len(applicants) == 1 and applicants[0]["id"] == app_id
    assert client.get(f"/api/vendor/jobs/{job['id']}/applicants", headers=org_b["h"]).status_code == 404
    rep = client.get(f"/api/vendor/applicants/{app_id}/report", headers=org_a["h"])
    assert rep.status_code == 200, rep.text
    assert client.get(f"/api/vendor/applicants/{app_id}/report", headers=org_b["h"]).status_code == 404
    # Candidate sees their own application list; no other candidate's data.
    mine = client.get("/api/applications", headers=cand["h"]).json()["applications"]
    assert any(a.get("jobId") == job["id"] for a in mine)
    assert client.get("/api/applications", headers=other["h"]).json()["applications"] == []


def test_ranked_applicant_list_orders_by_interview_score(client, world, fake_llm):
    job, org_a = world["job"], world["a"]
    strong = ("I designed idempotent FastAPI endpoints backed by PostgreSQL with unique keys, used Kafka consumer "
              "groups with retries and a dead letter topic, measured p95 latency, and wrote integration tests in Docker.")
    ids = {}
    for label, answer in (("weak", "I am not sure."), ("strong", strong)):
        c = _signup(client, name=label)
        app_id = _apply(client, world, c)["applicationId"]
        s = client.post("/api/interview/start", json={"applicationId": app_id, "consent": CONSENT}, headers=c["h"]).json()
        r = client.post("/api/interview/score", json={"sessionId": s["sessionId"], "answers": [answer] * len(s["questions"])},
                        headers=c["h"])
        assert r.status_code == 200, r.text
        ids[label] = app_id
    applicants = client.get(f"/api/vendor/jobs/{job['id']}/applicants", headers=org_a["h"]).json()["applicants"]
    assert [a["id"] for a in applicants] == [ids["strong"], ids["weak"]]


# ── Vendor job management + tenant isolation ────────────────────────────────────────────────────────────────


def test_vendor_job_routes_are_tenant_isolated(client, world):
    job, a, b = world["job"], world["a"], world["b"]
    jobs_b = client.get("/api/vendor/jobs", headers=b["h"]).json()["jobs"]
    assert all(j["id"] != job["id"] for j in jobs_b)
    assert client.delete(f"/api/vendor/jobs/{job['id']}", headers=b["h"]).status_code in (403, 404)
    assert client.post(f"/api/vendor/jobs/{job['id']}/mark-deleted-for-candidates", headers=b["h"]).status_code == 404
    assert client.get(f"/api/vendor/jobs/{job['id']}/candidates", headers=b["h"]).status_code == 404
    assert client.get(f"/api/vendor/applicants/nope/interview-plan", headers=b["h"]).status_code in (403, 404)
    patch = client.patch("/api/vendor/applicants/nope", json={"status": "shortlisted"}, headers=b["h"])
    assert patch.status_code in (400, 404), patch.text
    # Owner can still see / delete it.
    assert any(j["id"] == job["id"] for j in client.get("/api/vendor/jobs", headers=a["h"]).json()["jobs"])
    deleted = client.delete(f"/api/vendor/jobs/{job['id']}", headers=a["h"])
    assert deleted.status_code == 200, deleted.text
    assert client.get(f"/api/jobs/public/{job['shareableCode']}").status_code == 404


def test_applicant_status_patch_and_alerts(client, world):
    a, b = world["a"], world["b"]
    app_id = _apply(client, world)["applicationId"]
    alerts = client.get("/api/vendor/application-alerts", headers=a["h"])
    assert alerts.status_code == 200 and alerts.json()["total"] >= 1
    assert "resumeText" not in alerts.text
    assert client.get("/api/vendor/application-alerts", headers=b["h"]).json()["total"] == 0
    assert client.post("/api/vendor/application-alerts/read", json={"ids": "notalist"}, headers=a["h"]).status_code == 200
    assert client.post("/api/vendor/application-alerts/read", json={}, headers=a["h"]).status_code == 200
    assert client.get("/api/vendor/application-alerts", headers=a["h"]).json()["total"] == 0
    bad = client.patch(f"/api/vendor/applicants/{app_id}", json={"status": "<script>"}, headers=a["h"])
    assert bad.status_code == 400, bad.text
    ok = client.patch(f"/api/vendor/applicants/{app_id}", json={"status": "Shortlisted"}, headers=a["h"])
    assert ok.status_code == 200, ok.text
    listed = client.get(f"/api/vendor/jobs/{world['job']['id']}/applicants", headers=a["h"]).json()["applicants"]
    assert listed[0]["status"] == "shortlisted"  # persisted, normalised
    cross = client.patch(f"/api/vendor/applicants/{app_id}", json={"status": "rejected"}, headers=b["h"])
    assert cross.status_code == 404, cross.text


def test_candidate_job_list_and_withdraw(client, world):
    cand = world["cand"]
    jobs = client.get("/api/jobs?scope=all&summary=1&limit=5", headers=cand["h"])
    assert jobs.status_code == 200, jobs.text
    assert client.get("/api/jobs?limit=abc&offset=-5&summary=1", headers=cand["h"]).status_code == 200
    app = _apply(client, world)
    cand_app_id = app["candidateApplication"]["id"]
    other = _signup(client)
    assert client.delete(f"/api/applications/{cand_app_id}", headers=other["h"]).status_code in (200, 404)
    assert any(a["id"] == cand_app_id for a in client.get("/api/applications", headers=cand["h"]).json()["applications"])
    gone = client.delete(f"/api/applications/{cand_app_id}", headers=cand["h"])
    assert gone.status_code == 200, gone.text


# ── Misc routes ──────────────────────────────────────────────────────────────────────────────────────────────


def test_misc_public_routes_do_not_leak_secrets(client):
    assert client.get("/api/interview/tts/status").status_code == 401
    for path in ("/api/health", "/api/llm-status", "/api/mail/status", "/api/plans"):
        res = client.get(path)
        assert res.status_code in (200, 503), (path, res.status_code)
        body = res.text.lower()
        for secret_word in ("password", "postgresql://", "api_key\":\"a", "secret\":\""):
            assert secret_word not in body, (path, secret_word)


def test_contact_form_validation(client):
    assert client.post("/api/contact", json={"name": "", "email": "a@b.co", "message": "hello"}).status_code == 400
    assert client.post("/api/contact", json=[]).status_code == 400
    ok = client.post("/api/contact", json={"name": "N", "email": "a@b.co", "message": "hello there"})
    assert ok.status_code == 200


def test_cron_routes_need_the_secret(client, monkeypatch):
    monkeypatch.setenv("CRON_SECRET", "qa-cron-secret")
    for path in ("/api/internal/interview-reminders", "/api/internal/maintenance"):
        assert client.post(path).status_code == 401
        assert client.post(path, headers={"x-cron-secret": "wrong"}).status_code == 401
        # Non-ASCII header value: hmac.compare_digest on str raised TypeError -> 500.
        assert client.post(path, headers={"x-cron-secret": "qa-cron-secrét".encode("latin-1")}).status_code == 401
    ok = client.post("/api/internal/maintenance", headers={"x-cron-secret": "qa-cron-secret"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["ok"] is True


def test_unknown_api_route_is_404_json(client):
    res = client.get("/api/definitely/not/here")
    assert res.status_code == 404 and res.json()["error"]


# ── Recruiter invite -> public invite page -> reminder -> reschedule ─────────────────────────────────────────


def _invite(client, world, app_id, **body):
    from datetime import datetime, timedelta, timezone

    payload = {"scheduledStart": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(), "durationMinutes": 30}
    payload.update(body)
    return client.post(f"/api/vendor/applicants/{app_id}/interview-invite", json=payload, headers=world["a"]["h"])


def test_invite_input_validation_is_400_not_500(client, world):
    app_id = _apply(client, world)["applicationId"]
    for body in (
        {"scheduledStart": "not a date"},
        {"scheduledStart": None},
        {"durationMinutes": "abc"},
        {"durationMinutes": "nan"},
        {"durationMinutes": "inf"},
        {"durationMinutes": 5},
        {"durationMinutes": 500},
        {"scheduledStart": "2020-01-01T10:00:00Z"},
    ):
        res = _invite(client, world, app_id, **body)
        assert res.status_code == 400, (body, res.status_code, res.text)
    assert _invite(client, world, "nope").status_code == 404
    cross = client.post(
        f"/api/vendor/applicants/{app_id}/interview-invite",
        json={"scheduledStart": "2099-01-01T10:00:00Z"},
        headers=world["b"]["h"],
    )
    assert cross.status_code == 404


def test_invite_with_a_naive_time_is_read_as_utc(client, world):
    from datetime import datetime, timedelta, timezone

    app_id = _apply(client, world)["applicationId"]
    naive = (datetime.now(timezone.utc) + timedelta(days=3)).replace(tzinfo=None, microsecond=0)
    res = _invite(client, world, app_id, scheduledStart=naive.isoformat())
    assert res.status_code == 201, res.text
    assert res.json()["invite"]["scheduledStart"].startswith(naive.isoformat())
    assert res.json()["invite"]["scheduledStart"].endswith("Z")


def test_invite_page_reminder_and_reschedule(client, world, monkeypatch):
    from datetime import datetime, timedelta, timezone

    cand, other = world["cand"], _signup(client)
    app_id = _apply(client, world)["applicationId"]
    res = _invite(client, world, app_id)
    assert res.status_code == 201, res.text
    token = res.json()["invite"]["token"]
    assert res.json()["invite"]["emailSent"] is False  # mail is off in tests
    page = client.get(f"/api/interview-invites/{token}")
    assert page.status_code == 200, page.text
    inv = page.json()["invite"]
    # Anyone holding the link: no resume, no JD, no recruiter-side scores (the address is shown so the page can say
    # which account to sign in with).
    assert inv["resumeText"] == "" and inv["jobDescription"] == "" and inv["atsScore"] is None and inv["jdMatchScore"] is None
    mine = client.get(f"/api/interview-invites/{token}", headers=cand["h"]).json()["invite"]
    assert mine["signedInAsInvitee"] is True and mine["resumeText"] and mine["atsScore"] is not None
    assert client.get(f"/api/interview-invites/{token}", headers=other["h"]).json()["invite"]["resumeText"] == ""
    assert client.get("/api/interview-invites/doesnotexist").status_code == 404
    # Reminders: secret required; mail off -> due reminders are recorded in-app (never sends).
    monkeypatch.setenv("CRON_SECRET", "qa-cron-secret")
    assert client.post("/api/internal/interview-reminders").status_code == 401
    off = client.post("/api/internal/interview-reminders", headers={"x-cron-secret": "qa-cron-secret"})
    assert off.status_code == 200 and off.json()["emailConfigured"] is False  # recorded in-app, never 503
    # A recruiter-scheduled slot cannot be moved by the candidate.
    new = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
    refused = client.post(f"/api/interview-invites/{token}/reschedule", json={"scheduledStart": new}, headers=cand["h"])
    assert refused.status_code == 403 and refused.json()["code"] == "RESCHEDULE_NOT_ALLOWED"


def test_self_booked_interview_can_be_rescheduled(client, world, monkeypatch):
    """Candidate books a slot (mail mocked, never sent) -> reschedule rules incl. offset-less times."""
    from datetime import datetime, timedelta, timezone

    from app.dispatch import route_extensions, schedule_routes

    sent: list[str] = []

    async def fake_send_mail(*, to, subject, html, text=None):
        sent.append(to)

    monkeypatch.setattr(route_extensions, "smtp_configured", lambda: True)
    monkeypatch.setattr(route_extensions, "send_mail", fake_send_mail)
    monkeypatch.setattr(schedule_routes, "smtp_configured", lambda: False)
    cand, other = world["cand"], _signup(client)
    when = (datetime.now(timezone.utc) + timedelta(days=1)).replace(microsecond=0)
    bad = client.post("/api/interview/confirmation-email", json={"scheduledStart": when.isoformat(), "durationMinutes": "nan"},
                      headers=cand["h"])
    assert bad.status_code == 400, bad.text
    booked = client.post("/api/interview/confirmation-email", json={"scheduledStart": when.isoformat(), "durationMinutes": 20},
                         headers=cand["h"])
    assert booked.status_code == 200, booked.text
    assert sent == [cand["email"]]
    token = booked.json()["token"]
    new = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
    url = f"/api/interview-invites/{token}/reschedule"
    assert client.post(url, json={"scheduledStart": new}, headers=other["h"]).status_code == 403
    assert client.post(url, json={"scheduledStart": "x"}, headers=cand["h"]).status_code == 400
    soon = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
    assert client.post(url, json={"scheduledStart": soon}, headers=cand["h"]).status_code == 400
    far = (datetime.now(timezone.utc) + timedelta(days=60)).isoformat()
    assert client.post(url, json={"scheduledStart": far}, headers=cand["h"]).status_code == 400
    naive = (datetime.now(timezone.utc) + timedelta(days=4)).replace(tzinfo=None, microsecond=0).isoformat()
    moved = client.post(url, json={"scheduledStart": naive}, headers=cand["h"])  # used to be a 500 (naive vs aware)
    assert moved.status_code == 200, moved.text
    assert moved.json()["scheduledStart"] == naive + "Z"
    assert client.post("/api/interview-invites/doesnotexist/reschedule", json={"scheduledStart": new}, headers=cand["h"]).status_code == 403


def test_slot_booking_is_saved_when_email_is_not_configured(client, world, monkeypatch):
    """E2E journey: with email off, "Confirm slot" returned 503 before saving anything, so the candidate was stuck on
    onboarding step 2 and no booking / reminder / reschedule link existed. The booking must not depend on email."""
    from datetime import datetime, timedelta, timezone

    from app.dispatch import route_extensions

    async def must_not_send(**_kw):
        raise AssertionError("no email may be sent when mail is not configured")

    monkeypatch.setattr(route_extensions, "smtp_configured", lambda: False)
    monkeypatch.setattr(route_extensions, "send_mail", must_not_send)
    cand = world["cand"]
    when = (datetime.now(timezone.utc) + timedelta(days=2)).replace(microsecond=0)
    res = client.post("/api/interview/confirmation-email", json={"scheduledStart": when.isoformat(), "durationMinutes": 20},
                      headers=cand["h"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["emailSent"] is False and body["emailError"] and body["smtpConfigured"] is False
    assert body["token"] and body["inviteUrl"].endswith(body["token"])
    page = client.get(f"/api/interview-invites/{body['token']}", headers=cand["h"])
    assert page.status_code == 200, page.text


def test_bulk_invite_send_validation(client, world):
    h = world["a"]["h"]
    for body in ({}, {"emails": "x"}, {"emails": ["not-an-email"]}, {"emails": ["a@b.co"] * 600}):
        res = client.post("/api/vendor/interview-invites/send", json=body, headers=h)
        assert res.status_code in (400, 413, 429), (body, res.status_code, res.text)
    assert client.post("/api/vendor/interview-invites/send", json={"emails": ["a@b.co"]}, headers=world["cand"]["h"]).status_code == 403


# ── Paid retakes (Razorpay mocked) ───────────────────────────────────────────────────────────────────────────


@pytest.fixture
def fake_razorpay(monkeypatch):
    import httpx

    monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_test_qa")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", "qa-secret")
    orders: list[dict] = []

    class FakeResponse:
        status_code = 200

        def __init__(self, data):
            self._data = data
            self.text = json.dumps(data)

        def json(self):
            return self._data

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, auth=None, json=None):
            order = {"id": f"order_{secrets.token_hex(6)}", **(json or {})}
            orders.append(order)
            return FakeResponse(order)

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)
    return orders


def _sig(order_id, payment_id, secret="qa-secret"):
    import hashlib
    import hmac

    return hmac.new(secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()


def _career_start(client, cand):
    return client.post(
        "/api/interview/start",
        json={"consent": CONSENT, "role": "Backend Engineer", "level": "3 – 5 Years"},
        headers=cand["h"],
    )


def _finish(client, cand, start_json):
    return client.post(
        "/api/interview/score",
        json={"sessionId": start_json["sessionId"], "answers": ["I built FastAPI services on PostgreSQL."] * len(start_json["questions"])},
        headers=cand["h"],
    )


def test_retake_payment_flow(client, fake_llm, fake_razorpay):
    cand, other = _signup(client), _signup(client)
    client.put("/api/profile", json={"resumeText": RESUME, "currentRole": "Backend Engineer", "totalExperience": "3 – 5 Years"},
               headers=cand["h"])
    st = client.get("/api/payments/retake/status", headers=cand["h"]).json()
    assert st["freeInterviewAvailable"] is True and st["paymentsConfigured"] is True
    assert "qa-secret" not in json.dumps(st)
    first = _career_start(client, cand)
    assert first.status_code == 200, first.text
    assert _finish(client, cand, first.json()).status_code == 200
    blocked = _career_start(client, cand)
    assert blocked.status_code == 402 and blocked.json()["code"] == "RETAKE_PAYMENT_REQUIRED"

    order = client.post("/api/payments/retake/order", headers=cand["h"])
    assert order.status_code == 201, order.text
    oid = order.json()["orderId"]
    assert fake_razorpay[-1]["amount"] == order.json()["amount"]
    verify = "/api/payments/retake/verify"
    pay = f"pay_{secrets.token_hex(6)}"
    # Wrong signature, someone else's order, non-ASCII signature, junk body: 4xx, never 500.
    assert client.post(verify, json={"razorpay_order_id": oid, "razorpay_payment_id": pay, "razorpay_signature": "0" * 64},
                       headers=cand["h"]).status_code == 400
    assert client.post(verify, json={"razorpay_order_id": oid, "razorpay_payment_id": pay, "razorpay_signature": _sig(oid, pay)},
                       headers=other["h"]).status_code == 404
    assert client.post(verify, json={"razorpay_order_id": oid, "razorpay_payment_id": pay, "razorpay_signature": "é" * 64},
                       headers=cand["h"]).status_code == 400
    assert client.post(verify, json={"razorpay_order_id": 5, "razorpay_payment_id": None}, headers=cand["h"]).status_code in (400, 404)
    assert client.post(verify, content="nope", headers={**cand["h"], "Content-Type": "application/json"}).status_code == 400
    # Good signature twice in parallel -> exactly one credit.
    results: list[int] = []

    def go():
        r = client.post(verify, json={"razorpay_order_id": oid, "razorpay_payment_id": pay, "razorpay_signature": _sig(oid, pay)},
                        headers=cand["h"])
        results.append(r.status_code)

    threads = [threading.Thread(target=go) for _ in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert results == [200] * 4
    st = client.get("/api/payments/retake/status", headers=cand["h"]).json()
    assert st["retakeCredits"] == 1 and st["canStartCareerInterview"] is True
    second = _career_start(client, cand)
    assert second.status_code == 200, second.text
    assert client.get("/api/payments/retake/status", headers=cand["h"]).json()["retakeCredits"] == 0
    assert _career_start(client, cand).status_code == 402
    # Replaying the same Razorpay payment id on a NEW order (valid signature for that pair) is refused, not a 500.
    oid2 = client.post("/api/payments/retake/order", headers=cand["h"]).json()["orderId"]
    replay = client.post(verify, json={"razorpay_order_id": oid2, "razorpay_payment_id": pay,
                                       "razorpay_signature": _sig(oid2, pay)}, headers=cand["h"])
    assert replay.status_code == 409, replay.text
    assert client.get("/api/payments/retake/status", headers=cand["h"]).json()["retakeCredits"] == 0
    assert client.put("/api/payments/retake/status", headers=cand["h"]).status_code == 405


def test_job_interviews_stay_free_after_the_free_career_interview(client, world, fake_llm):
    cand = world["cand"]
    client.put("/api/profile", json={"resumeText": RESUME}, headers=cand["h"])
    first = _career_start(client, cand)
    assert first.status_code == 200
    _finish(client, cand, first.json())
    app_id = _apply(client, world)["applicationId"]
    job_start = client.post("/api/interview/start", json={"applicationId": app_id, "consent": CONSENT}, headers=cand["h"])
    assert job_start.status_code == 200, job_start.text
    # A bare public jobId (without the candidate's own application) is not a free job interview.
    other = _signup(client)
    client.put("/api/profile", json={"resumeText": RESUME}, headers=other["h"])
    _finish(client, other, _career_start(client, other).json())
    sneaky = client.post("/api/interview/start", json={"jobId": world["job"]["id"], "consent": CONSENT}, headers=other["h"])
    assert sneaky.status_code in (402, 403, 404), sneaky.text


# ── Robustness sweep: junk input on every route must never be a 500 ─────────────────────────────────────────

_SWEEP_ROUTES = [
    ("GET", "/api/candidate/job-alerts"), ("GET", "/api/jobs?limit=x&offset=y&scope=zzz"),
    ("GET", "/api/jobs/public/%ZZ"), ("POST", "/api/jobs/public/%ZZ/apply"),
    ("POST", "/api/vendor/jobs"), ("GET", "/api/vendor/jobs"),
    ("POST", "/api/vendor/jobs/{job}/mark-deleted-for-candidates"),
    ("GET", "/api/vendor/application-alerts"), ("POST", "/api/vendor/application-alerts/read"),
    ("GET", "/api/vendor/jobs/{job}/applicants"), ("GET", "/api/vendor/candidates?experienceYears=abc&limit=-1&page=x"),
    ("GET", "/api/vendor/candidate-documents/resume"), ("GET", "/api/vendor/candidate-documents/resume?email=nobody@x.y"),
    ("GET", "/api/vendor/jobs/{job}/candidates?limit=abc"), ("GET", "/api/vendor/applicants/nope/report"),
    ("GET", "/api/vendor/applicants/nope/interview-plan"), ("PATCH", "/api/vendor/applicants/nope"),
    ("POST", "/api/vendor/applicants/nope/interview-invite"), ("POST", "/api/vendor/interview-invites/send"),
    ("GET", "/api/vendor/candidate-documents/recording"), ("GET", "/api/vendor/candidate-documents/report"),
    ("GET", "/api/vendor/candidate-documents/report?email=nobody@x.y"),
    ("GET", "/api/vendor/interview-review"), ("GET", "/api/vendor/interview-review?sessionId=nope&email=x@y.z"),
    ("POST", "/api/interview/start"), ("POST", "/api/interview/next"), ("POST", "/api/interview/turn"),
    ("POST", "/api/interview/interact"), ("POST", "/api/interview/score"), ("POST", "/api/interview/integrity"),
    ("POST", "/api/interview"), ("GET", "/api/interview/flow"), ("POST", "/api/interview/transcribe"),
    ("GET", "/api/interview/session/00000000-0000-0000-0000-000000000000"),
    ("GET", "/api/interview/review-events"), ("GET", "/api/interview/review-events?sessionId=nope"),
    ("POST", "/api/interview/review-events"), ("PATCH", "/api/interview/review-events"),
    ("POST", "/api/interview/confirmation-email"), ("GET", "/api/interview/recordings/playback"),
    ("GET", "/api/interview/recordings/playback?sessionId=nope"),
    ("POST", "/api/interview/recordings/upload"), ("POST", "/api/interview/recordings/upload-url"),
    ("POST", "/api/interview/recordings/complete"), ("GET", "/api/interview/recordings/nope/download"),
    ("POST", "/api/interview/artifacts/report"), ("GET", "/api/interview/artifacts/nope"),
    ("GET", "/api/interview-invites/nope"), ("POST", "/api/interview-invites/nope/reschedule"),
    ("GET", "/api/applications"), ("POST", "/api/applications"), ("DELETE", "/api/applications/nope"),
    ("GET", "/api/talent/search?q=python&limit=abc&experience=x"), ("GET", "/api/talent/candidates/nope"),
    ("POST", "/api/resume/upload"), ("GET", "/api/resume/download"), ("POST", "/api/resume/parse"),
    ("POST", "/api/resume/replace"),
    ("GET", "/api/confidential/candidates"), ("POST", "/api/confidential/candidates"),
    ("GET", "/api/confidential/candidates/nope"), ("PUT", "/api/confidential/candidates/nope/status"),
    ("DELETE", "/api/confidential/candidates/nope"), ("GET", "/api/confidential/export"), ("GET", "/api/confidential/stats"),
    ("GET", "/api/payments/retake/status"), ("POST", "/api/payments/retake/order"), ("POST", "/api/payments/retake/verify"),
    ("GET", "/api/assessments"), ("GET", "/api/assessments/jobs"), ("POST", "/api/assessments/jobs"),
    ("POST", "/api/assessments/resumes"), ("POST", "/api/assessments/generate"),
    ("GET", "/api/assessments/00000000-0000-0000-0000-000000000000"),
    ("POST", "/api/assessments/00000000-0000-0000-0000-000000000000/start"),
    ("GET", "/api/me"), ("PUT", "/api/profile"), ("GET", "/api/organization"), ("POST", "/api/contact"),
    ("POST", "/api/password/forgot"), ("POST", "/api/password/reset"), ("POST", "/api/logout"),
    ("GET", "/api/interview/tts/status"), ("POST", "/api/interview/tts"),
]

_JUNK_BODIES = [
    {},
    {"sessionId": "nope", "answers": "x", "events": "x", "status": 5, "scheduledStart": "x", "email": 5,
     "candidates": "x", "ids": 5, "jobId": {"a": 1}, "applicationId": ["x"], "text": 5, "resumeText": 5,
     "fileData": 5, "consent": "yes", "questions": "x", "integrity": "x", "profile": "x", "name": ["x"],
     "token": 5, "password": 5, "eventId": 5, "explanation": 5},
    {"sessionId": None, "answers": [None, 5, {"a": 1}], "events": [None, 5, "x"], "fileData": "data:,%%%",
     "fileName": "../../etc/passwd", "consent": {"recording": True}, "profile": {"skills": "x"}},
]


@pytest.mark.parametrize("role", ["candidate", "employer"])
def test_no_route_returns_500_on_junk_input(client, world, role, fake_llm):
    who = world["cand"] if role == "candidate" else world["a"]
    failures = []
    for method, path in _SWEEP_ROUTES:
        path = path.replace("{job}", world["job"]["id"])
        bodies = [None] if method == "GET" else _JUNK_BODIES + ["raw-not-json"]
        for body in bodies:
            if body == "raw-not-json":
                res = client.request(method, path, content="{oops", headers={**who["h"], "Content-Type": "application/json"})
            else:
                res = client.request(method, path, json=body, headers=who["h"])
            if res.status_code >= 500 and res.status_code not in (501, 503):
                failures.append((method, path, body if body is None or isinstance(body, str) else list(body)[:3],
                                 res.status_code, res.text[:200]))
    assert not failures, "\n".join(map(str, failures))


def test_junk_input_on_a_live_session_is_never_a_500(client, world, fake_llm):
    cand = world["cand"]
    app_id = _apply(client, world)["applicationId"]
    s = client.post("/api/interview/start", json={"applicationId": app_id, "consent": CONSENT}, headers=cand["h"]).json()
    sid = s["sessionId"]
    junk = [
        {"sessionId": sid},
        {"sessionId": sid, "history": "x", "lastQuestion": "x", "lastAnswer": 5, "profile": "x"},
        {"sessionId": sid, "history": [None, 5, "x", {"question": 5}], "lastQuestion": {"text": 5}},
        {"sessionId": sid, "events": "x"}, {"sessionId": sid, "events": [{"eventType": None}]},
        {"sessionId": sid, "answers": [None, {"x": 1}], "integrity": {"flaggedSections": "x", "logs": 5}},
        {"sessionId": sid, "integrity": {"faceViolations": "abc", "maxFacesSeen": None}},
        {"sessionId": sid, "eventId": None, "explanation": {"a": 1}},
    ]
    failures = []
    for path, methods in (("/api/interview/next", ["POST"]), ("/api/interview/integrity", ["POST"]),
                          ("/api/interview/review-events", ["POST", "PATCH"]), ("/api/interview/turn", ["POST"]),
                          ("/api/interview/score", ["POST"])):
        for m in methods:
            for body in junk:
                r = client.request(m, path, json=body, headers=cand["h"])
                if r.status_code >= 500:
                    failures.append((m, path, body, r.status_code, r.text[:200]))
    assert not failures, "\n".join(map(str, failures))
    assert client.get(f"/api/interview/review-events?sessionId={sid}", headers=cand["h"]).status_code == 200


def test_parallel_signups_with_one_email_create_one_account(client):
    email = f"race-{secrets.token_hex(4)}@qa.test"
    codes: list[int] = []
    barrier = threading.Barrier(8)

    def go():
        barrier.wait()
        r = client.post("/api/signup", json={"name": "R", "email": email, "password": "Passw0rd!x", "phone": _phone()})
        codes.append(r.status_code)

    threads = [threading.Thread(target=go) for _ in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(codes) == [201] + [409] * 7, codes


# ── Confidential vault ───────────────────────────────────────────────────────────────────────────────────────


def test_confidential_vault_crud_and_isolation(client, world):
    a, b = world["a"], world["b"]
    url = "/api/confidential/candidates"
    assert client.post(url, json={}, headers=a["h"]).status_code == 400
    made = client.post(url, json={"name": "Vault Person", "email": "v@p.co", "interviewScore": 70}, headers=a["h"])
    assert made.status_code == 201, made.text
    cid = made.json()["candidate"]["id"]
    assert client.get(f"{url}/{cid}", headers=a["h"]).status_code == 200
    assert client.get(f"{url}/{cid}", headers=b["h"]).status_code == 404
    assert all(c["id"] != cid for c in client.get(url, headers=b["h"]).json().get("candidates", []))
    assert client.put(f"{url}/{cid}/status", json={"status": "Shortlisted"}, headers=b["h"]).status_code == 404
    assert client.put(f"{url}/{cid}/status", json={"status": "Shortlisted"}, headers=a["h"]).status_code == 200
    # NaN / Infinity scores (Python's json accepts them) must not poison stats/export (JSON has no NaN -> 500).
    for raw in ('{"name": "N", "interviewScore": NaN}', '{"name": "I", "interviewScore": Infinity}'):
        r = client.post(url, content=raw, headers={**a["h"], "Content-Type": "application/json"})
        assert r.status_code in (201, 400), (raw, r.status_code, r.text)
    for path in ("/api/confidential/stats", "/api/confidential/export", url):
        r = client.get(path, headers=a["h"])
        assert r.status_code == 200, (path, r.status_code, r.text)
    stats = client.get("/api/confidential/stats", headers=a["h"]).json()
    assert stats["averageTalentScore"] == 70
    b_del = client.delete(f"{url}/{cid}", headers=b["h"])
    assert b_del.status_code in (200, 404)
    assert client.get(f"{url}/{cid}", headers=a["h"]).status_code == 200  # other org's delete did nothing
    assert client.delete(f"{url}/{cid}", headers=a["h"]).status_code == 200
    assert client.get(f"{url}/{cid}", headers=a["h"]).status_code == 404


def test_nan_and_infinity_are_rejected_not_500(client, world):
    cand = world["cand"]
    h = {**cand["h"], "Content-Type": "application/json"}
    for method, path, raw in (
        ("PUT", "/api/profile", '{"totalExperience": NaN, "skills": ["x"]}'),
        ("PUT", "/api/profile", '{"score": Infinity}'),
        ("POST", "/api/login", '{"email": "a@b.co", "password": NaN}'),
        ("POST", "/api/signup", '{"name": "x", "email": "a@b.co", "password": "Passw0rd!x", "phone": NaN}'),
        ("POST", "/api/contact", '{"name": "x", "email": "a@b.co", "message": "hello", "n": NaN}'),
    ):
        r = client.request(method, path, content=raw, headers=h)
        assert r.status_code < 500, (method, path, r.status_code, r.text)
    assert client.get("/api/me", headers=cand["h"]).status_code == 200


# ── N+1 guard ────────────────────────────────────────────────────────────────────────────────────────────────


def test_applicant_list_query_count_does_not_grow_per_applicant(client, world, monkeypatch):
    from app.db.uow import UnitOfWork

    calls: list[str] = []
    original = UnitOfWork.query

    def counting(self, sql, params=()):
        calls.append(sql)
        return original(self, sql, params)

    def count_for(n_extra):
        for _ in range(n_extra):
            c = _signup(client)
            client.put("/api/profile", json={"resumeText": RESUME}, headers=c["h"])
            _apply(client, world, c)
        monkeypatch.setattr(UnitOfWork, "query", counting)
        calls.clear()
        res = client.get(f"/api/vendor/jobs/{world['job']['id']}/applicants", headers=world["a"]["h"])
        monkeypatch.setattr(UnitOfWork, "query", original)
        assert res.status_code == 200
        return len(calls), res.json()["total"]

    q2, n2 = count_for(2)
    q8, n8 = count_for(6)
    assert (n2, n8) == (2, 8)
    assert q8 <= q2 + 1, (q2, q8)  # constant, not ~2 queries per extra applicant
