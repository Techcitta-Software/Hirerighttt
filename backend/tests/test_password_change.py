"""Signed-in password change (POST /api/password/change). DB and sessions are faked: never touches a real database."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.auth_passwords import hash_password, verify_password
from app.routes import auth_node
from app.server import runtime
from app.services import password_reset as pw


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch):
    user = {
        "id": "u-change-test",
        "name": "Change Tester",
        "email": "change.tester@example.com",
        "passwordHash": hash_password("old-password-1"),
        "role": "jobseeker",
        "status": "active",
    }
    db = {"users": [user]}
    revoked: list[str] = []
    sessions: list[tuple[str, str]] = []

    async def fake_save_db(_db) -> None:
        return None

    async def fake_auth(_request) -> str:
        return user["email"]

    async def fake_register(token: str, email: str) -> None:
        sessions.append((token, email))

    monkeypatch.setattr(runtime, "load_db", lambda: db)
    monkeypatch.setattr(runtime, "save_db", fake_save_db)
    monkeypatch.setattr(runtime, "rate_limit", lambda *a, **k: True)
    monkeypatch.setattr(runtime, "require_auth_email", fake_auth)
    monkeypatch.setattr(runtime, "register_session", fake_register)
    monkeypatch.setattr(pw, "revoke_all_sessions", lambda _url, email: revoked.append(email))
    return {"user": user, "revoked": revoked, "sessions": sessions}


def _change(client: TestClient, current: str, new: str):
    return client.post(
        "/api/password/change",
        json={"currentPassword": current, "newPassword": new},
        headers={"authorization": "Bearer test-token"},
    )


def test_change_password_updates_hash_and_returns_new_session(client: TestClient, env) -> None:
    res = _change(client, "old-password-1", "brand-new-pass-9")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True and len(body["token"]) == 32
    assert verify_password("brand-new-pass-9", env["user"]["passwordHash"])
    assert not verify_password("old-password-1", env["user"]["passwordHash"])
    assert env["sessions"] == [(body["token"], "change.tester@example.com")]
    if auth_node.config.database_url:
        assert env["revoked"] == ["change.tester@example.com"]


def test_change_password_rejects_wrong_current_password(client: TestClient, env) -> None:
    res = _change(client, "not-my-password", "brand-new-pass-9")
    assert res.status_code == 400
    assert "incorrect" in str(res.json()).lower()
    assert verify_password("old-password-1", env["user"]["passwordHash"])
    assert env["sessions"] == []


def test_change_password_rejects_weak_or_same_password(client: TestClient, env) -> None:
    assert _change(client, "old-password-1", "short").status_code == 400
    assert _change(client, "old-password-1", "old-password-1").status_code == 400
    assert _change(client, "", "brand-new-pass-9").status_code == 400
    assert verify_password("old-password-1", env["user"]["passwordHash"])


def test_change_password_requires_sign_in(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    res = client.post("/api/password/change", json={"currentPassword": "x", "newPassword": "brand-new-pass-9"})
    assert res.status_code == 401
