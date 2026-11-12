from __future__ import annotations

import socket

from app.db import resolve_pg_host as mod


def _reset():
    mod._cache.clear()


def test_uses_system_dns_when_it_works(monkeypatch):
    _reset()
    monkeypatch.setattr(mod, "_reachable", lambda *a, **k: True)
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [(socket.AF_INET, 1, 6, "", ("10.0.0.5", 5432))])
    assert mod.resolve_pg_host("db.example.test") == ("10.0.0.5", "db.example.test")


def test_accepts_ipv6_only_hosts(monkeypatch):
    _reset()
    monkeypatch.setattr(mod, "_reachable", lambda *a, **k: True)
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [(socket.AF_INET6, 1, 6, "", ("2600::1", 5432, 0, 0))])
    assert mod.resolve_pg_host("v6.example.test") == ("2600::1", "v6.example.test")


def test_falls_back_to_public_dns_when_system_dns_refuses(monkeypatch):
    _reset()

    def refuse(*_a, **_k):
        raise socket.gaierror(11001, "getaddrinfo failed")

    monkeypatch.setattr(socket, "getaddrinfo", refuse)
    monkeypatch.setattr(mod, "_reachable", lambda *a, **k: True)
    monkeypatch.setattr(mod, "_doh_lookup_all", lambda host: ["2600:1f16::5"])
    assert mod.resolve_pg_host("blocked.example.test") == ("2600:1f16::5", "blocked.example.test")


def test_returns_hostname_unchanged_when_nothing_resolves(monkeypatch):
    _reset()
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: (_ for _ in ()).throw(socket.gaierror()))
    monkeypatch.setattr(mod, "_doh_lookup_all", lambda host: [])
    assert mod.resolve_pg_host("nowhere.example.test") == ("nowhere.example.test", None)


def test_skips_a_dead_address_and_uses_one_that_answers(monkeypatch):
    _reset()
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [(socket.AF_INET, 1, 6, "", ("77.0.0.1", 5432))])
    monkeypatch.setattr(mod, "_doh_lookup_all", lambda host: ["3.14.0.9"])
    monkeypatch.setattr(mod, "_reachable", lambda addr, *a, **k: addr == "3.14.0.9")
    assert mod.resolve_pg_host("flaky.example.test") == ("3.14.0.9", "flaky.example.test")


def test_result_is_cached_for_a_few_minutes(monkeypatch):
    _reset()
    calls = []
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: calls.append(1) or [(socket.AF_INET, 1, 6, "", ("10.0.0.5", 5432))])
    monkeypatch.setattr(mod, "_reachable", lambda *a, **k: True)
    mod.resolve_pg_host("cache.example.test")
    mod.resolve_pg_host("cache.example.test")
    assert len(calls) == 1
