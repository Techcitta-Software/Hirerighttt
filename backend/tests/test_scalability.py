"""Scalability helpers: short read cache, per-request user index, rate-limit sweep."""

from __future__ import annotations

import asyncio

import pytest

from app.db import store
from app.server import runtime
from app.services.vendor import org_candidates as oc


@pytest.fixture(autouse=True)
def _clean_cache(monkeypatch):
    monkeypatch.setattr(store, "_READ_TTL_S", 60.0)
    store.invalidate_read_caches()
    yield
    store.invalidate_read_caches()


def test_throttled_sync_skips_query_while_fresh_and_refreshes_after_write():
    calls = []

    @store._throttled_sync
    def sync(url, db, org="a"):
        calls.append(org)
        return db

    db = {}
    sync("x", db, "a")
    sync("x", db, "a")
    sync("x", db, "a")
    assert calls == ["a"]  # one query, two cache hits
    sync("x", db, "b")
    assert calls == ["a", "b"]  # different argument => its own entry

    @store._invalidates_reads
    def write():
        return None

    write()
    sync("x", db, "a")
    assert calls == ["a", "b", "a"]  # a write drops the cache


def test_throttled_sync_disabled_when_ttl_zero(monkeypatch):
    monkeypatch.setattr(store, "_READ_TTL_S", 0)
    calls = []

    @store._throttled_sync
    def sync(url, db):
        calls.append(1)
        return db

    db = {}
    sync("x", db)
    sync("x", db)
    assert len(calls) == 2


def test_cached_rows_returns_independent_copies():
    calls = []

    @store._cached_rows
    def load(url, email):
        calls.append(email)
        return [{"id": "1", "n": {"k": 1}}]

    first = load("x", "a@b.c")
    first[0]["n"]["k"] = 99  # caller mutates its copy
    second = load("x", "a@b.c")
    assert calls == ["a@b.c"]
    assert second[0]["n"]["k"] == 1


def test_write_during_refresh_is_not_cached():
    calls = []

    @store._throttled_sync
    def sync(url, db):
        calls.append(1)
        store.invalidate_read_caches()  # a write lands while the query runs
        return db

    db = {}
    sync("x", db)
    sync("x", db)
    assert len(calls) == 2  # the first result was stale, so it was not kept


def test_user_index_matches_linear_scan():
    db = {
        "users": [
            {"id": "u1", "email": "A@x.com", "role": "jobseeker"},
            {"id": "u2", "email": "b@x.com", "role": "employer"},
            {"id": "u3", "email": "c@x.com", "role": "jobseeker", "primaryOrganizationId": "o1"},
        ],
        "organizationMembers": [{"userId": "u3", "role": "recruiter"}],
    }
    idx = oc._Index(db)
    for email, uid in [("a@x.com", None), ("B@X.COM", None), (None, "u3"), ("zzz@x.com", None)]:
        assert oc._find_user(db, email or "", uid, idx) == oc._find_user(db, email or "", uid)
    for email, uid in [("a@x.com", "u1"), ("b@x.com", "u2"), ("c@x.com", "u3"), ("nobody@x.com", None)]:
        assert oc._is_employer_or_recruiter_account(db, email, uid, set(), idx) == oc._is_employer_or_recruiter_account(
            db, email, uid, set()
        )
    assert oc._is_employer_or_recruiter_account(db, "c@x.com", "u3", set(), idx) is True  # recruiter member


def test_rate_limit_sweeps_stale_keys(monkeypatch):
    monkeypatch.setattr(runtime, "_rate_buckets", {})
    monkeypatch.setattr(runtime, "_RATE_SWEEP_AT", 10)
    for i in range(30):
        assert runtime.rate_limit(f"k{i}", 5, 60_000)
    # age every bucket beyond the 1h sweep horizon, then trigger a sweep with the next call
    for k in list(runtime._rate_buckets):
        runtime._rate_buckets[k] = [0.0]
    assert runtime.rate_limit("fresh", 5, 60_000)
    assert len(runtime._rate_buckets) < 30


def test_llm_gate_is_per_loop_and_bounded(monkeypatch):
    from app.services import gemini_client

    monkeypatch.setenv("GEMINI_MAX_CONCURRENCY", "2")
    monkeypatch.setattr(gemini_client, "_gates", {})

    async def run():
        active = 0
        peak = 0

        async def job():
            nonlocal active, peak
            async with gemini_client._llm_gate():
                active += 1
                peak = max(peak, active)
                await asyncio.sleep(0.01)
                active -= 1

        await asyncio.gather(*(job() for _ in range(10)))
        return peak

    assert asyncio.run(run()) == 2
