"""Security / performance fixes that need a real (throwaway) Postgres. Skipped without TEST_DATABASE_URL."""

from __future__ import annotations

import asyncio
import os
import secrets
import threading
import time

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not set")


@pytest.fixture
def url():
    from app.db import store as db_store
    from app.node_config import config

    original = config.database_url
    object.__setattr__(config, "database_url", os.environ["TEST_DATABASE_URL"])
    db_store.close_store()
    db_store._ensure_schema(config.database_url)
    yield config.database_url
    db_store.close_store()
    object.__setattr__(config, "database_url", original)


def _pool(url):
    from app.db import store

    return store.db_pool(url)


def test_migration_0005_indexes_exist(url):
    with _pool(url).connection() as conn:
        names = {r["indexname"] for r in conn.execute("SELECT indexname FROM pg_indexes").fetchall()}
    for idx in ("uq_retake_free_claim_email", "idx_interview_sessions_email_lower",
                "idx_interview_recordings_email_lower", "idx_interview_artifacts_email_lower"):
        assert idx in names, idx


def test_free_interview_is_claimed_exactly_once_under_concurrency(url):
    """V-06: 12 parallel interview starts -> exactly one free slot."""
    from psycopg.rows import dict_row

    from app.services import retake_payments as rp

    email = f"race-{secrets.token_hex(4)}@test.local"
    wins: list[bool] = []
    barrier = threading.Barrier(12)

    def start(i):
        barrier.wait()
        with _pool(url).connection() as conn:
            conn.row_factory = dict_row
            got = rp.claim_free_interview(conn, email, f"s{i}")
            conn.commit()
        wins.append(got)

    threads = [threading.Thread(target=start, args=(i,)) for i in range(12)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert wins.count(True) == 1
    with _pool(url).connection() as conn:
        conn.row_factory = dict_row
        status = rp.retake_status(conn, email.upper())
    assert status["freeInterviewAvailable"] is False and status["canStartCareerInterview"] is False


def test_failed_logins_lock_the_account_for_every_worker(url, monkeypatch):
    """V-13: counters in Postgres (shared by all workers), cleared on success."""
    from app.services import login_guard

    monkeypatch.setenv("LOGIN_MAX_FAILURES", "3")
    email = f"brute-{secrets.token_hex(4)}@test.local"
    assert login_guard.is_locked(url, email) is False
    assert [login_guard.record_failure(url, email) for _ in range(3)] == [False, False, True]
    assert login_guard.is_locked(url, email.upper()) is True
    login_guard.clear(url, email)
    assert login_guard.is_locked(url, email) is False
    with _pool(url).connection() as conn:
        rows = conn.execute("SELECT email_hash FROM login_failures").fetchall()
    assert all("@" not in r["email_hash"] for r in rows)  # no addresses stored


def test_session_tokens_are_stored_hashed_and_old_plain_rows_still_work(url):
    """V-17."""
    from app.db import store

    token = secrets.token_hex(16)
    email = f"sess-{secrets.token_hex(4)}@test.local"
    store.save_session_token(url, token, email)
    with _pool(url).connection() as conn:
        stored = conn.execute("SELECT token FROM hireright_sessions WHERE email = %s", (email,)).fetchone()["token"]
    assert stored != token and stored == store.session_token_key(token)
    assert store.resolve_session_email(url, token) == email
    assert store.resolve_session_email(url, stored) is None  # a leaked hash is not a usable token
    legacy = secrets.token_hex(16)
    with _pool(url).connection() as conn:
        conn.execute("INSERT INTO hireright_sessions (token, email, expires_at) VALUES (%s, %s, NOW() + INTERVAL '1 day')",
                     (legacy, email))
        conn.commit()
    assert store.resolve_session_email(url, legacy) == email
    store.delete_session_token(url, legacy)
    store.delete_session_token(url, token)
    assert store.resolve_session_email(url, legacy) is None and store.resolve_session_email(url, token) is None


def test_open_job_summaries_are_slim_cached_and_invalidated(url):
    """P-03: list columns only, description cut in SQL, cache dropped by writes."""
    from app.db import store
    from app.services.vendor.jobs import public_job_list_payload

    tag = secrets.token_hex(4)
    org = f"org-{tag}"
    with _pool(url).connection() as conn:
        conn.execute("INSERT INTO organizations (id, name, slug, status) VALUES (%s, %s, %s, 'active')", (org, org, org))
        conn.commit()
    job = {"id": f"job-{tag}", "organizationId": org, "title": f"Engineer {tag}", "company": "Acme",
           "jobDescription": "x" * 5000, "requiredSkills": ["Python"], "shareableCode": f"c{tag}", "status": "published",
           "createdAt": "2026-11-20T00:00:00Z"}
    store.upsert_job_record(url, job)
    rows = store.open_job_summaries(url)
    mine = next(r for r in rows if r["id"] == job["id"])
    assert len(mine["jobDescription"]) == 361
    assert public_job_list_payload(mine)["jobDescription"].endswith("…")
    store.upsert_job_record(url, {**job, "title": f"Renamed {tag}"})  # write -> cache invalidated
    assert next(r for r in store.open_job_summaries(url) if r["id"] == job["id"])["title"] == f"Renamed {tag}"
    store.delete_job_record(url, job["id"], org)


def test_api_stays_responsive_under_concurrent_logins_and_dashboard_calls(url):
    """The local API was reported to hang (login > 10 s). 30 concurrent sign-ins + /api/me + /api/jobs must finish
    quickly with a 5-connection pool: no pool exhaustion, no event-loop stall."""
    import httpx

    from app.auth_passwords import hash_password
    from app.main import app
    from app.server import ratelimit, runtime

    ratelimit.reset_for_tests()
    runtime._SESSION_CACHE.clear()
    tag = secrets.token_hex(4)
    pw_hash = hash_password("correct horse battery")
    emails = [f"load-{tag}-{i}@test.local" for i in range(10)]
    with _pool(url).connection() as conn:
        for i, em in enumerate(emails):
            conn.execute(
                "INSERT INTO users (id, email, name, password_hash, role, status) VALUES (%s,%s,%s,%s,'jobseeker','active')",
                (f"u-{tag}-{i}", em, f"Load {i}", pw_hash),
            )
        conn.commit()

    async def one(client, em):
        r = await client.post("/api/login", json={"email": em, "password": "correct horse battery"})
        assert r.status_code == 200, r.text
        h = {"Authorization": f"Bearer {r.json()['token']}"}
        for path in ("/api/me", "/api/me?lite=1", "/api/jobs?summary=1&scope=matched", "/api/plans"):
            res = await client.get(path, headers=h)
            assert res.status_code == 200, (path, res.text)

    async def run():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=30) as client:
            # event-loop probe: a tick that should fire every 50 ms while the requests run
            ticks = []

            async def ticker():
                for _ in range(400):
                    ticks.append(time.perf_counter())
                    await asyncio.sleep(0.05)

            t = asyncio.create_task(ticker())
            started = time.perf_counter()
            await asyncio.gather(*(one(client, em) for em in emails * 3))
            elapsed = time.perf_counter() - started
            t.cancel()
            gaps = [b - a for a, b in zip(ticks, ticks[1:])]
            return elapsed, max(gaps) if gaps else 0

    elapsed, worst_gap = asyncio.run(run())
    assert elapsed < 30, elapsed
    # scrypt + queries run in worker threads: the loop is never blocked for long (it was seconds before)
    assert worst_gap < 1.0, worst_gap
    with _pool(url).connection() as conn:
        conn.execute("DELETE FROM users WHERE email = ANY(%s)", (emails,))
        conn.commit()
