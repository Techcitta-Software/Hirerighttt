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
