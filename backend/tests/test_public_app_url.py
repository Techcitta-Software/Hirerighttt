"""Links in emails (invites, reminders, password resets) use PUBLIC_APP_URL, else the trusted request origin."""

from __future__ import annotations

import pytest

from app.services import interview_invites as inv


class _Req:
    def __init__(self, **headers: str) -> None:
        self.headers = {k.lower(): v for k, v in headers.items()}


@pytest.fixture(autouse=True)
def _no_url_env(monkeypatch):
    for key in inv.PUBLIC_URL_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("NODE_ENV", "development")
    import dataclasses

    from app import node_config

    monkeypatch.setattr(
        node_config,
        "config",
        dataclasses.replace(node_config.config, cors_origins=["https://app.hireright.test", "http://localhost:5183"]),
    )


def test_public_app_url_wins_and_is_reduced_to_the_origin(monkeypatch):
    monkeypatch.setenv("PUBLIC_APP_URL", "https://jobs.example.com/")
    assert inv.public_app_origin("http://localhost:5183") == "https://jobs.example.com"
    assert inv.invite_public_url("tok") == "https://jobs.example.com/interview/invite/tok"


def test_vite_public_app_url_is_read_by_the_api_too(monkeypatch):
    """.env.example documents VITE_PUBLIC_APP_URL as shared with the API; it used to be ignored here."""
    monkeypatch.setenv("VITE_PUBLIC_APP_URL", "https://www.example.org")
    assert inv.public_app_origin() == "https://www.example.org"


def test_a_url_with_a_path_or_bad_scheme_is_not_used(monkeypatch):
    monkeypatch.setenv("PUBLIC_APP_URL", "javascript:alert(1)")
    monkeypatch.setenv("FRONTEND_URL", "https://example.com/some/path")
    assert inv.public_app_origin("https://app.hireright.test") == "https://app.hireright.test"


def test_unset_falls_back_to_the_request_origin_when_it_is_allowed():
    assert inv.trusted_request_origin(_Req(Origin="http://localhost:5183")) == "http://localhost:5183"
    assert inv.trusted_request_origin(_Req(Referer="https://app.hireright.test/employer/jobs?x=1")) == "https://app.hireright.test"
    origin = inv.trusted_request_origin(_Req(Origin="http://localhost:5183"))
    assert inv.invite_public_url("abc", origin) == "http://localhost:5183/interview/invite/abc"


def test_an_unlisted_origin_never_reaches_an_email_link():
    assert inv.trusted_request_origin(_Req(Origin="https://evil.example")) is None
    assert inv.trusted_request_origin(_Req()) is None
    assert inv.trusted_request_origin(None) is None


def test_production_without_url_or_request_origin_refuses_to_build_localhost_links(monkeypatch):
    monkeypatch.setenv("NODE_ENV", "production")
    with pytest.raises(RuntimeError):
        inv.public_app_origin()
    assert inv.public_app_origin("https://app.hireright.test") == "https://app.hireright.test"


def test_development_without_url_or_request_uses_the_configured_web_origin():
    """Scheduler reminders / scripts have no browser request: use the site in CORS_ORIGINS, not localhost:5173."""
    assert inv.public_app_origin() == "https://app.hireright.test"
    assert inv.invite_public_url("tok") == "https://app.hireright.test/interview/invite/tok"


def test_development_without_anything_uses_the_dev_server(monkeypatch):
    import dataclasses

    from app import node_config

    monkeypatch.setattr(node_config, "config", dataclasses.replace(node_config.config, cors_origins=["*"]))
    assert inv.public_app_origin() == "http://localhost:5173"


@pytest.mark.skipif(not __import__("os").environ.get("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not set")
def test_invite_route_links_to_the_site_the_recruiter_is_on(client):
    """No PUBLIC_APP_URL: the invite link follows the (allowed) Origin of the recruiter's browser, not localhost:5173."""
    from datetime import datetime, timedelta, timezone

    from tests.test_qa_e2e_db import RESUME, _job_body, _signup

    org = _signup(client, role="employer", name="Rita Recruiter", company="Origin Co")
    job = client.post("/api/vendor/jobs", json=_job_body(), headers=org["h"]).json()["job"]
    cand = _signup(client, name="Cand")
    app_id = client.post(f"/api/jobs/public/{job['shareableCode']}/apply", json={"resumeText": RESUME},
                         headers=cand["h"]).json()["applicationId"]
    when = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    url = f"/api/vendor/applicants/{app_id}/interview-invite"
    ok = client.post(url, json={"scheduledStart": when, "durationMinutes": 30},
                     headers={**org["h"], "Origin": "http://localhost:5183"})
    assert ok.status_code == 201, ok.text
    assert ok.json()["invite"]["inviteUrl"].startswith("http://localhost:5183/interview/invite/")
    evil = client.post(url, json={"scheduledStart": when, "durationMinutes": 30},
                       headers={**org["h"], "Origin": "https://evil.example"})
    assert evil.status_code in (201, 403), evil.text  # CORS may refuse it outright; never an evil link
    if evil.status_code == 201:
        assert not evil.json()["invite"]["inviteUrl"].startswith("https://evil.example")
