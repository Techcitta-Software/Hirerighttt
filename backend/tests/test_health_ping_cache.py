"""/api/health reuses a healthy database ping briefly and always re-checks a failed one."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

from app.routes import health_node

DB_CONFIG = SimpleNamespace(database_url="postgresql://example/db")


def _run(coro):
    return asyncio.run(coro)


def test_healthy_ping_is_reused(monkeypatch):
    calls = []

    def fake_ping(url):
        calls.append(url)
        return {"ok": True}

    monkeypatch.setattr(health_node, "config", DB_CONFIG)
    monkeypatch.setattr(health_node, "ping_database", fake_ping)
    monkeypatch.setattr(health_node, "_ping_cache", {"at": 0.0, "value": None})

    assert _run(health_node._async_ping())["ok"] is True
    assert _run(health_node._async_ping())["ok"] is True
    assert len(calls) == 1


def test_failed_ping_is_rechecked(monkeypatch):
    results = [{"ok": False, "reason": "down"}, {"ok": True}]
    calls = []

    def fake_ping(url):
        calls.append(url)
        return results[len(calls) - 1]

    monkeypatch.setattr(health_node, "config", DB_CONFIG)
    monkeypatch.setattr(health_node, "ping_database", fake_ping)
    monkeypatch.setattr(health_node, "_ping_cache", {"at": 0.0, "value": None})

    assert _run(health_node._async_ping())["ok"] is False
    assert _run(health_node._async_ping())["ok"] is True
    assert len(calls) == 2


def test_stale_ping_is_refreshed(monkeypatch):
    calls = []

    def fake_ping(url):
        calls.append(url)
        return {"ok": True}

    monkeypatch.setattr(health_node, "config", DB_CONFIG)
    monkeypatch.setattr(health_node, "ping_database", fake_ping)
    monkeypatch.setattr(health_node, "_ping_cache", {"at": -1000.0, "value": {"ok": True}})

    _run(health_node._async_ping())
    assert len(calls) == 1
