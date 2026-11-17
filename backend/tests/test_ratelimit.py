"""Rate limiter: in-memory window, shared Redis counters, and fail-open when Redis is down."""

from __future__ import annotations

from app.server import ratelimit


class FakeRedis:
    def __init__(self) -> None:
        self.counts: dict[str, int] = {}
        self.ttls: dict[str, int] = {}

    def incr(self, key: str) -> int:
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]

    def pexpire(self, key: str, ms: int) -> None:
        self.ttls[key] = ms

    def pttl(self, key: str) -> int:
        return self.ttls.get(key, -1)


class DeadRedis:
    def incr(self, key: str) -> int:
        raise ConnectionError("redis is down")


def _use(monkeypatch, client) -> None:
    ratelimit.reset_for_tests()
    monkeypatch.setattr(ratelimit, "_redis", client)
    monkeypatch.setattr(ratelimit, "_redis_checked", True)


def test_memory_window_blocks_after_limit(monkeypatch):
    _use(monkeypatch, None)
    assert [ratelimit.allow("a", 3) for _ in range(5)] == [True, True, True, False, False]
    assert ratelimit.allow("other", 3)  # separate key, separate budget


def test_redis_counts_are_shared_and_expire(monkeypatch):
    fake = FakeRedis()
    _use(monkeypatch, fake)
    assert [ratelimit.allow("login:1.2.3.4", 2, 60_000) for _ in range(3)] == [True, True, False]
    assert fake.counts["rl:login:1.2.3.4"] == 3
    assert fake.ttls["rl:login:1.2.3.4"] == 60_000  # window set on the first hit


def test_redis_outage_fails_open_to_memory(monkeypatch):
    _use(monkeypatch, DeadRedis())
    assert ratelimit.allow("x", 2)
    assert ratelimit.allow("x", 2)
    assert not ratelimit.allow("x", 2)  # still limited, by the in-memory fallback
