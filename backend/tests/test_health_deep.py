"""GET /api/health?deep=1 probes the database with a 30s connect timeout. Plain /api/health is unchanged."""

from __future__ import annotations

from app.routes import health_node


def _set_url(url: str) -> str:
    previous = health_node.config.database_url
    object.__setattr__(health_node.config, "database_url", url)
    return previous


def test_deep_health_selects_with_a_30s_connect_timeout(client, monkeypatch):
    import psycopg

    seen = {}

    class Conn:
        def execute(self, sql):
            seen["sql"] = sql
            return self

        def fetchone(self):
            return (1,)

        def __enter__(self):
            return self

        def __exit__(self, *_a):
            return False

    def connect(url, connect_timeout=None, **_kw):
        seen["url"] = url
        seen["connect_timeout"] = connect_timeout
        return Conn()

    monkeypatch.setattr(psycopg, "connect", connect)
    previous = _set_url("postgresql://example/db")
    try:
        res = client.get("/api/health?deep=1")
        assert res.status_code == 200, res.text
        assert res.json() == {"ok": True, "deep": True}
        assert seen["sql"] == "SELECT 1"
        assert seen["connect_timeout"] == 30
        assert seen["url"] == "postgresql://example/db"
    finally:
        _set_url(previous)


def test_deep_health_is_503_when_the_database_is_down(client, monkeypatch):
    import psycopg

    def connect(*_a, **_k):
        raise RuntimeError("down")

    monkeypatch.setattr(psycopg, "connect", connect)
    previous = _set_url("postgresql://example/db")
    try:
        res = client.get("/api/health?deep=1")
        assert res.status_code == 503
        assert res.json() == {"ok": False, "deep": True}
    finally:
        _set_url(previous)


def test_deep_health_is_503_when_no_database_is_configured(client):
    previous = _set_url("")
    try:
        res = client.get("/api/health?deep=1")
        assert res.status_code == 503
        assert res.json()["ok"] is False and res.json()["deep"] is True
    finally:
        _set_url(previous)


def test_plain_health_contract_is_unchanged(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True and body["service"] == "hireright-api"
    assert "deep" not in body
    assert "database" in body and "features" in body
