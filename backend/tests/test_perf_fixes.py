"""Performance fixes keep behaviour: cached clients / previews / parses, background work, smaller list payloads."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone

import pytest

from app.assessment.contracts import AssessmentError

# --- S3: one client per process, explicit timeouts ------------------------------------------------------------------


def test_s3_client_is_built_once_with_timeouts(monkeypatch):
    from app.services.storage import s3_storage

    monkeypatch.setenv("AWS_REGION", "us-east-1")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIATEST")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "secret")
    s3_storage.reset_client_cache()
    try:
        a = s3_storage._client()
        b = s3_storage._client()
        assert a is b
        cfg = a.meta.config
        assert cfg.connect_timeout == 3 and cfg.read_timeout == 30
        assert cfg.retries["mode"] == "adaptive" and cfg.max_pool_connections >= 20
        assert cfg.signature_version == "s3v4"
        monkeypatch.setenv("AWS_REGION", "eu-west-1")  # settings changed: a new client
        c = s3_storage._client()
        assert c is not a and c.meta.region_name == "eu-west-1"
        # presigning needs no network and still works on the shared client
        monkeypatch.setenv("S3_BUCKET", "bucket-x")
        url = s3_storage.presign_download("users/u1/resume/a.pdf")["url"]
        assert "bucket-x" in url and "X-Amz-Signature" in url
    finally:
        s3_storage.reset_client_cache()


def test_artifact_head_runs_off_the_event_loop(monkeypatch):
    from app.services.storage import interview_artifact_storage as art

    calls = {}

    def fake_head(key):
        import threading

        calls["thread"] = threading.current_thread().name
        return None  # missing file -> still a 404

    monkeypatch.setattr(art, "head_object", fake_head)
    monkeypatch.setattr(art, "active_s3_bucket_name", lambda: None)
    with pytest.raises(art.ArtifactStorageError) as err:
        asyncio.run(art._presign_artifact_row({"s3_object_key": "k"}, "report"))
    assert err.value.status == 404
    assert calls["thread"] != "MainThread"


# --- Resume parse: no OCR subprocess without paddleocr, thinking setting, cache --------------------------------------


def test_paddle_is_skipped_when_not_installed(monkeypatch):
    from app.dispatch import api_dispatch

    api_dispatch.paddle_ocr_available.cache_clear()
    monkeypatch.setattr(api_dispatch.importlib.util, "find_spec", lambda name: None)

    def boom(*a, **k):
        raise AssertionError("subprocess must not run")

    monkeypatch.setattr(api_dispatch.subprocess, "run", boom)
    try:
        assert api_dispatch.paddle_ocr_available() is False
        assert asyncio.run(api_dispatch._run_paddle(b"%PDF-1.4", "a.pdf")) is None
    finally:
        api_dispatch.paddle_ocr_available.cache_clear()


def test_resume_ai_parse_uses_minimal_thinking_and_is_cached(monkeypatch):
    from app.services import gemini_client
    from app.services import interview_api as ia

    seen = []

    class Result:
        text = json.dumps({"fullName": "Priya Raman", "skills": ["Python"], "currentRole": "Engineer", "extra": 1})
        model = "m"

    async def fake_generate(**kw):
        seen.append(kw)
        return Result()

    monkeypatch.setattr(gemini_client, "gemini_configured", lambda: True)
    monkeypatch.setattr(gemini_client, "generate_content", fake_generate)
    ia._resume_parse_cache.clear()
    text = "Priya Raman\nSenior Backend Engineer\nPython, FastAPI, PostgreSQL, Kafka. Built order services." * 2
    first = asyncio.run(ia.parse_resume_with_ai(text))
    first["fullName"] = "mutated by caller"
    second = asyncio.run(ia.parse_resume_with_ai(text))
    assert len(seen) == 1 and seen[0]["thinking"] == "minimal"
    assert second["fullName"] == "Priya Raman" and second["source"] == "gemini" and "extra" not in second
    asyncio.run(ia.parse_resume_with_ai(text + " More."))  # different resume -> a new call
    assert len(seen) == 2
    ia._resume_parse_cache.clear()


# --- Assessments: overall time limit, lighter reasoning, evaluation after the response -------------------------------


def test_assessment_calls_have_an_overall_budget_and_light_thinking(monkeypatch):
    from app.assessment import provider

    calls = []

    async def failing(**kw):
        calls.append(kw)
        return None  # provider gave nothing: the second attempt shares the same budget

    monkeypatch.setattr(provider, "gemini_configured", lambda: True)
    monkeypatch.setattr(provider, "generate_content", failing)
    with pytest.raises(AssessmentError):
        asyncio.run(provider.structured_call(system="s", payload={}, validate=lambda d: d, purpose="evaluation"))
    assert len(calls) == 2
    assert all(c["total_budget"] <= 35.0 and c["timeout"] <= 30.0 for c in calls)
    assert calls[0]["thinking"] == "minimal" and calls[0]["max_tokens"] == 4000

    calls.clear()
    with pytest.raises(AssessmentError):
        asyncio.run(provider.structured_call(system="s", payload={}, validate=lambda d: d, purpose="plan"))
    assert calls[0]["thinking"] == "low" and calls[0]["total_budget"] <= 40.0 and calls[0]["max_tokens"] == 12000


def _fake_assessment(monkeypatch, *, evaluate):
    from app.assessment import service

    question = {"question_id": "q1", "question_text": "Tell me about X", "competency": "ownership"}
    store = {"evaluations": []}

    def record_answer(actor, sid, body, message):
        return {
            "answer": {"id": "a-1"},
            "updated": {"id": sid, "status": "in_progress", "current_index": 1, "version": 2},
            "questions": [question, {**question, "question_id": "q2"}],
            "question": question,
        }

    def store_eval(answer_id, generated):
        store["evaluations"].append({"answer_id": answer_id, "data": generated["data"]})

    monkeypatch.setattr(service, "_record_answer", record_answer)
    monkeypatch.setattr(service, "_store_evaluation", store_eval)
    monkeypatch.setattr(service, "structured_call", evaluate)
    return service, question, store


def test_answer_returns_before_evaluation_and_the_evaluation_is_saved(monkeypatch):
    gate = None

    async def evaluate(**kw):
        await gate.wait()
        return {"data": {"score": 3}, "model": "m"}

    service, _q, store = _fake_assessment(monkeypatch, evaluate=evaluate)

    async def run():
        nonlocal gate
        gate = asyncio.Event()
        view = await service._message({"id": "c1"}, "s1", {"message": "my answer"})
        assert view["evaluation_status"] == "pending" and view["answer_id"] == "a-1"
        assert view["current_question_index"] == 1
        assert store["evaluations"] == []  # not scored yet: the candidate did not wait for it
        gate.set()
        await asyncio.wait_for(service._eval_tasks.get("a-1") or asyncio.sleep(0), 5)
        await asyncio.sleep(0)

    asyncio.run(run())
    assert store["evaluations"] == [{"answer_id": "a-1", "data": {"score": 3}}]


def test_report_scores_answers_whose_evaluation_failed(monkeypatch):
    attempts = []

    async def evaluate(**kw):
        attempts.append(1)
        if len(attempts) == 1:
            raise AssessmentError(503, "provider down")
        return {"data": {"score": 4}, "model": "m"}

    service, question, store = _fake_assessment(monkeypatch, evaluate=evaluate)
    job = {"competencies": [{"id": "ownership", "name": "Ownership", "requirement": "r", "weight": 100}]}

    def report_rows(actor, sid):
        return {
            "session": {"candidate_id": "c1", "status": "completed"},
            "questions": [question],
            "job": job,
            "answers": [{"id": "a-1", "question_id": "q1", "answer_text": "my answer"}],
            "evaluations": list(store["evaluations"]),
        }

    monkeypatch.setattr(service, "_report_rows", report_rows)
    monkeypatch.setattr(service, "_load_session_evaluations", lambda sid: list(store["evaluations"]))
    monkeypatch.setattr(
        service, "aggregate", lambda job, qs, answers, evals: {"overall": evals[0]["data"]["score"] if evals else None}
    )

    async def run():
        await service._message({"id": "c1"}, "s1", {"message": "my answer"})
        task = service._eval_tasks.get("a-1")
        if task:
            await task  # first attempt fails and is logged; the answer stays saved
        assert store["evaluations"] == []
        return await service._report({"id": "c1"}, "s1")

    report = asyncio.run(run())
    assert len(attempts) == 2
    assert report["evaluations_pending"] == 0 and report["overall"] == 4
    assert [e["answer_id"] for e in report["evaluations"]] == ["a-1"]


# --- Interview-plan preview cache ----------------------------------------------------------------------------------


def test_interview_plan_preview_is_cached_per_inputs():
    from app.services.vendor import interview_plan_cache as cache

    cache.clear()
    builds = []

    async def build():
        builds.append(1)
        await asyncio.sleep(0.01)
        return {"questions": [{"text": f"q{len(builds)}"}]}

    async def run():
        k1 = cache.plan_cache_key(applicationId="a1", jobDescription="JD", profile={"resumeText": "R1"})
        k2 = cache.plan_cache_key(applicationId="a1", jobDescription="JD", profile={"resumeText": "R2"})
        k3 = cache.plan_cache_key(applicationId="a1", jobDescription="JD v2", profile={"resumeText": "R1"})
        assert len({k1, k2, k3}) == 3  # a resume or job edit never reuses the old preview
        (p1, c1), (p2, c2) = await asyncio.gather(cache.get_or_build(k1, build), cache.get_or_build(k1, build))
        assert len(builds) == 1 and p1 == p2 and not c1  # concurrent opens share one call
        p3, c3 = await cache.get_or_build(k1, build)
        assert c3 and p3 == p1 and len(builds) == 1
        p3["questions"].clear()  # callers get copies
        assert (await cache.get_or_build(k1, build))[0] == p1
        p4, c4 = await cache.get_or_build(k1, build, refresh=True)
        assert not c4 and len(builds) == 2 and p4["questions"][0]["text"] == "q2"

        async def failing():
            raise RuntimeError("gemini down")

        with pytest.raises(RuntimeError):
            await cache.get_or_build(k2, failing)
        p5, c5 = await cache.get_or_build(k2, build)  # failures are not cached
        assert not c5 and p5["questions"]

    asyncio.run(run())
    cache.clear()


def test_interview_plan_cache_expires(monkeypatch):
    from app.services.vendor import interview_plan_cache as cache

    cache.clear()
    cache.put("k", {"x": 1})
    assert cache.get("k") == {"x": 1}
    real = cache.time.monotonic
    monkeypatch.setattr(cache.time, "monotonic", lambda: real() + cache.TTL_S + 1)
    assert cache.get("k") is None
    cache.clear()


# --- Vendor candidate list: scope=org, capped resume text, batched talent lookups ------------------------------------


def _org_db() -> dict:
    long_resume = "Python FastAPI " * 1000  # 15 000 chars
    return {
        "users": [
            {"id": "u-app", "email": "app@x.com", "role": "jobseeker", "name": "Applicant", "createdAt": "2026-01-01"},
            {"id": "u-plat", "email": "plat@x.com", "role": "jobseeker", "name": "Platform", "createdAt": "2026-01-02"},
            {"id": "u-rec", "email": "rec@org.com", "role": "employer", "name": "Recruiter"},
        ],
        "organizationMembers": [{"userId": "u-rec", "organizationId": "org-a", "role": "owner"}],
        "profiles": {"plat@x.com": {"fullName": "Platform Person", "resumeText": long_resume}},
        "interviews": {},
        "jobs": [{"id": "job-1", "organizationId": "org-a", "title": "Backend", "status": "published"}],
        "employerApplications": [
            {
                "id": "app-1",
                "organizationId": "org-a",
                "jobId": "job-1",
                "candidateEmail": "app@x.com",
                "candidateUserId": "u-app",
                "status": "shortlisted",
                "appliedAt": "2026-02-01",
                "data": {"candidateName": "Applicant", "resumeText": long_resume, "jobTitle": "Backend"},
            }
        ],
        "confidentialVault": [
            {"id": "v-1", "organizationId": "org-a", "email": "vault@x.com", "name": "Vaulted", "resumeText": "short"}
        ],
        "interviewSessions": {},
    }


def test_org_scope_lists_only_the_organisations_own_candidates():
    from app.services.vendor.org_candidates import list_organization_candidates

    full = asyncio.run(list_organization_candidates(_org_db(), "org-a", "", {}))
    org = asyncio.run(list_organization_candidates(_org_db(), "org-a", "", {"scope": "org"}))
    # default list: platform roster included with contact details (owner decision, reverses V-05)
    plat = next(r for r in full["candidates"] if r["source"] == "platform")
    assert plat["candidateName"] == "Platform Person" and plat["contactHidden"] is False
    assert plat["candidateEmail"]
    own_full = sorted(r["candidateEmail"] for r in full["candidates"] if r["source"] not in ("platform", "talent"))
    assert sorted(r["candidateEmail"] for r in org["candidates"]) == own_full == ["app@x.com", "vault@x.com"]
    assert org["total"] == 2
    app_row = next(r for r in org["candidates"] if r["candidateEmail"] == "app@x.com")
    assert app_row["status"] == "Shortlisted" and app_row["source"] == "application"
    assert len(app_row["resumeText"]) == 4000 and app_row["resumeTextTruncated"] is True
    assert app_row["resumeTextLength"] == 15000
    vault_row = next(r for r in org["candidates"] if r["candidateEmail"] == "vault@x.com")
    assert vault_row["resumeText"] == "short" and "resumeTextTruncated" not in vault_row
    # the default (full) list still carries whole resumes: the resume database and dossier views show them
    assert all("resumeTextTruncated" not in r for r in full["candidates"])
    assert len(next(r for r in full["candidates"] if r["candidateEmail"] == "app@x.com")["resumeText"]) == 15000


def test_org_scope_never_runs_the_talent_search(monkeypatch):
    from app.services.vendor import org_candidates as oc

    async def boom(*a, **k):
        raise AssertionError("talent search must not run for scope=org")

    monkeypatch.setattr(oc, "search_candidate_talent", boom)
    monkeypatch.setattr(oc, "_all_job_seeker_roster_cached", lambda *a, **k: (_ for _ in ()).throw(AssertionError()))
    monkeypatch.setattr(oc, "_list_organization_talent_user_ids", lambda *a: [])
    out = asyncio.run(oc.list_organization_candidates(_org_db(), "org-a", "postgresql://unused", {"scope": "org"}))
    assert out["total"] == 2


def test_talent_merge_matches_the_per_hit_lookup(monkeypatch):
    from app.services.vendor import org_candidates as oc

    db = _org_db()
    hits = [
        {"email": "plat@x.com", "userId": "u-plat", "fullName": "Platform", "skills": ["Python"]},
        {"email": "renamed@x.com", "userId": "u-app", "fullName": "Renamed", "interviewScore": 71},  # found by id
        {"email": "ghost@x.com", "userId": "u-none", "fullName": "Ghost"},
    ]

    async def fake_search(*a, **k):
        return {"candidates": hits}

    monkeypatch.setattr(oc, "search_candidate_talent", fake_search)
    rows = []
    asyncio.run(oc._merge_talent_search("postgresql://unused", "org-a", {}, db, rows.append))
    expected = [oc._with_stored_interview(db, oc._record_from_talent_hit(db, h)) for h in hits]
    assert rows == expected
    assert rows[1]["interviewResult"]["overall"] == 71


def test_job_applicant_counts_in_one_pass():
    from app.db.finders import employer_app_counts_for_org

    db = _org_db()
    db["employerApplications"].append({"id": "app-2", "organizationId": "org-a", "jobId": "job-1", "candidateEmail": "b@x.com"})
    db["employerApplications"].append({"id": "app-3", "organizationId": "org-b", "jobId": "job-9", "candidateEmail": "c@x.com"})
    assert employer_app_counts_for_org(db, "org-a") == {"job-1": 2}
    assert employer_app_counts_for_org(db, "org-b") == {"job-9": 1}
    assert employer_app_counts_for_org(db, "") == {}


# --- Small things ----------------------------------------------------------------------------------------------------


def test_json_safe_fast_path_keeps_every_type():
    from app.server.json_safe import json_safe

    class D(dict):
        pass

    value = {
        "b": True,
        "n": None,
        "f": 1.5,
        "t": (1, datetime(2026, 1, 1, tzinfo=timezone.utc)),
        "sub": D(x={2, 3}),
        1: "int key",
    }
    out = json_safe(value)
    assert out["b"] is True and out["n"] is None and out["f"] == 1.5
    assert out["t"][1].startswith("2026-01-01") and sorted(out["sub"]["x"]) == [2, 3]
    assert out["1"] == "int key"
    json.dumps(out)


def test_role_skills_catalog_is_read_once(monkeypatch):
    from app.services import interview_agent

    interview_agent._role_skills_catalog.cache_clear()
    first = interview_agent._role_skills_catalog()
    assert interview_agent._role_skills_catalog() is first
    if first:
        role = next(iter(first))
        assert interview_agent._load_required_role_skills(role, None) == [str(s) for s in first[role][:3]]


def test_background_spawn_keeps_a_reference_and_logs_failures(caplog):
    from app.server import background

    async def run():
        async def fails():
            raise RuntimeError("boom")

        async def ok():
            return 1

        background.spawn(fails(), "t-fail")
        background.spawn(ok(), "t-ok")
        assert background.pending_count() >= 2
        await background.drain(2)
        await asyncio.sleep(0)

    with caplog.at_level("ERROR", logger="hireright.background"):
        asyncio.run(run())
    assert any("t-fail" in r.getMessage() for r in caplog.records)
    assert background.pending_count() == 0


def test_save_without_cacheable_writes_keeps_read_caches(monkeypatch):
    from app.db import store
    from app.db.uow import UnitOfWork
    from app.server import runtime

    class FakeUow(UnitOfWork):
        def __init__(self, names):
            super().__init__("postgresql://unused")
            self._names = names

        def flush(self):
            self.last_flushed = set(self._names)
            return len(self._names)

    before = store.read_cache_epoch()
    asyncio.run(runtime.save_db(FakeUow([])))
    asyncio.run(runtime.save_db(FakeUow(["interviewSessions"])))
    assert store.read_cache_epoch() == before  # interview turns / no-op saves no longer wipe every cache
    asyncio.run(runtime.save_db(FakeUow(["interviewSessions", "profiles"])))
    assert store.read_cache_epoch() == before + 1


def test_pool_checks_only_connections_that_sat_idle(monkeypatch):
    from app.db import store

    checked = []
    monkeypatch.setattr(store.ConnectionPool, "check_connection", staticmethod(lambda c: checked.append(c)))

    class Conn:
        pass

    conn = Conn()
    store._check_connection_if_idle(conn)  # never seen: checked
    store._note_connection_returned(conn)
    store._check_connection_if_idle(conn)  # just returned: no extra round trip
    assert checked == [conn]
    monkeypatch.setenv("DB_POOL_CHECK_IDLE_SECONDS", "0")
    store._check_connection_if_idle(conn)  # 0 = always check (old behaviour)
    assert checked == [conn, conn]


def test_me_lite_and_vendor_job_counts_shapes(client):
    """No database in this test run: the routes still answer 401 without a session (shape checks run in sweep)."""
    assert client.get("/api/me?lite=1").status_code == 401
    assert client.get("/api/vendor/candidates?scope=org").status_code in (401, 403)
