from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.server import runtime
from app.services.interview_consent import parse_interview_consent

FULL = {"version": "2026-11-07", "recording": True, "faceTracking": True, "aiScoring": True, "acceptedAt": "x"}


def test_full_consent_is_recorded_with_server_time_and_ip() -> None:
    record = parse_interview_consent(FULL, "203.0.113.5")
    assert record is not None
    assert record["version"] == "2026-11-07"
    assert record["ip"] == "203.0.113.5"
    assert record["recordedAt"].endswith("Z")


@pytest.mark.parametrize(
    "raw",
    [
        None,
        True,  # the old hard-coded flag is no longer enough
        {},
        {**FULL, "recording": False},
        {**FULL, "faceTracking": None},
        {**FULL, "aiScoring": "yes"},
        {**FULL, "version": ""},
    ],
)
def test_missing_or_partial_consent_is_rejected(raw) -> None:
    assert parse_interview_consent(raw, None) is None


def test_interview_start_refuses_without_consent(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_auth(_request) -> str:
        return "consent.tester@example.com"

    monkeypatch.setattr(runtime, "require_auth_email", fake_auth)
    res = client.post(
        "/api/interview/start",
        json={"role": "Software Engineer", "level": "1–3 years"},
        headers={"Authorization": "Bearer test"},
    )
    assert res.status_code == 400
    assert res.json()["code"] == "CONSENT_REQUIRED"
