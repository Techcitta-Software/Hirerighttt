from __future__ import annotations

from fastapi.testclient import TestClient


def test_liveness(client: TestClient) -> None:
    res = client.get("/api/health/live")
    assert res.status_code == 200
    assert res.json()["ok"] is True


def test_root(client: TestClient) -> None:
    res = client.get("/")
    assert res.status_code == 200
    assert res.json()["service"] == "hireright-api"


def test_cors_preflight_returns_allow_origin(client: TestClient) -> None:
    res = client.options(
        "/api/login",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,authorization",
        },
    )
    assert res.status_code == 200
    assert res.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_cors_preflight_on_dispatch_route(client: TestClient) -> None:
    res = client.options(
        "/api/interview/start",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"},
    )
    assert res.headers.get("access-control-allow-origin") == "http://localhost:5173"
