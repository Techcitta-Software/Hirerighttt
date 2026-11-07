"""Password reset routes. DB calls are replaced with an in-memory fake so these never touch Neon."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.auth_passwords import hash_password, verify_password
from app.routes import auth_node
from app.server import runtime
from app.services import password_reset as pw


class FakeTokens:
    def __init__(self) -> None:
        self.rows: dict[str, dict] = {}
        self.revoked: list[str] = []

    def store(self, _url: str, email: str, token: str, _ip: str | None) -> None:
        for row in self.rows.values():
            if row["email"] == email and row["used_at"] is None:
                row["used_at"] = datetime.now(timezone.utc)
        self.rows[pw.hash_reset_token(token)] = {
            "email": email,
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=pw.TOKEN_TTL_MINUTES),
            "used_at": None,
        }

    def consume(self, _url: str, token: str) -> str | None:
        row = self.rows.get(pw.hash_reset_token(token))
        if not row or row["used_at"] is not None or row["expires_at"] <= datetime.now(timezone.utc):
            return None
        row["used_at"] = datetime.now(timezone.utc)
        return row["email"]

    def revoke(self, _url: str, email: str) -> None:
        self.revoked.append(email)


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch):
    fake = FakeTokens()
    sent: list[dict] = []
    user = {
        "id": "u-reset-test",
        "name": "Reset Tester",
        "email": "reset.tester@example.com",
        "passwordHash": hash_password("old-password-1"),
        "role": "jobseeker",
        "status": "active",
    }
    db = {"users": [user]}

    async def fake_save_db(_db) -> None:
        return None

    async def fake_send_mail(**kwargs) -> None:
        sent.append(kwargs)

    monkeypatch.setattr(pw, "store_reset_token", fake.store)
    monkeypatch.setattr(pw, "consume_reset_token", fake.consume)
    monkeypatch.setattr(pw, "revoke_all_sessions", fake.revoke)
    monkeypatch.setattr(runtime, "load_db", lambda: db)
    monkeypatch.setattr(runtime, "save_db", fake_save_db)
    monkeypatch.setattr(runtime, "rate_limit", lambda *a, **k: True)
    monkeypatch.setattr(auth_node, "send_mail", fake_send_mail)
    monkeypatch.setattr(auth_node, "smtp_configured", lambda: True)
    # config is frozen; the routes only check DATABASE_URL is non-empty, and every DB call above is faked.
    if not auth_node.config.database_url.strip():
        pytest.skip("DATABASE_URL not set")
    monkeypatch.setenv("PUBLIC_APP_URL", "https://app.example.com")
    return {"fake": fake, "sent": sent, "user": user}


def _token_from(sent: list[dict]) -> str:
    text = sent[-1]["text"]
    return text.split("token=")[1].split()[0]


def test_token_is_stored_hashed_not_plain() -> None:
    token = pw.new_reset_token()
    assert len(token) >= 40
    assert pw.hash_reset_token(token) != token
    assert len(pw.hash_reset_token(token)) == 64


def test_password_rules() -> None:
    assert pw.validate_new_password("short") is not None
    assert pw.validate_new_password("        ") is not None
    assert pw.validate_new_password("long-enough-1") is None


def test_forgot_same_answer_for_known_and_unknown_email(client: TestClient, env) -> None:
    known = client.post("/api/password/forgot", json={"email": "reset.tester@example.com"})
    unknown = client.post("/api/password/forgot", json={"email": "nobody@example.com"})
    assert known.status_code == unknown.status_code == 200
    assert known.json() == unknown.json()
    assert len(env["sent"]) == 1
    assert env["sent"][0]["to"] == "reset.tester@example.com"
    assert "https://app.example.com/reset-password?token=" in env["sent"][0]["text"]


def test_forgot_rejects_malformed_email(client: TestClient, env) -> None:
    res = client.post("/api/password/forgot", json={"email": "not-an-email"})
    assert res.status_code == 400


def test_full_reset_flow_changes_password_and_signs_out(client: TestClient, env) -> None:
    client.post("/api/password/forgot", json={"email": "reset.tester@example.com"})
    token = _token_from(env["sent"])

    res = client.post("/api/password/reset", json={"token": token, "password": "brand-new-pass-9"})
    assert res.status_code == 200, res.text
    assert verify_password("brand-new-pass-9", env["user"]["passwordHash"])
    assert not verify_password("old-password-1", env["user"]["passwordHash"])
    assert env["fake"].revoked == ["reset.tester@example.com"]

    # Single use: the same link fails the second time.
    again = client.post("/api/password/reset", json={"token": token, "password": "another-pass-77"})
    assert again.status_code == 400


def test_new_request_invalidates_older_link(client: TestClient, env) -> None:
    client.post("/api/password/forgot", json={"email": "reset.tester@example.com"})
    first = _token_from(env["sent"])
    client.post("/api/password/forgot", json={"email": "reset.tester@example.com"})
    second = _token_from(env["sent"])
    assert client.post("/api/password/reset", json={"token": first, "password": "brand-new-pass-9"}).status_code == 400
    assert client.post("/api/password/reset", json={"token": second, "password": "brand-new-pass-9"}).status_code == 200


def test_reset_rejects_weak_password_without_using_token(client: TestClient, env) -> None:
    client.post("/api/password/forgot", json={"email": "reset.tester@example.com"})
    token = _token_from(env["sent"])
    weak = client.post("/api/password/reset", json={"token": token, "password": "abc"})
    assert weak.status_code == 400
    ok = client.post("/api/password/reset", json={"token": token, "password": "good-password-1"})
    assert ok.status_code == 200


def test_reset_rejects_unknown_token(client: TestClient, env) -> None:
    res = client.post("/api/password/reset", json={"token": "made-up-token", "password": "good-password-1"})
    assert res.status_code == 400
    assert "expired" in res.json().get("error", res.json().get("detail", ""))
