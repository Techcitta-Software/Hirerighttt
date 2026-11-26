"""Recruiter invite status (GET /api/vendor/interview-invites) and reminders while email is off.

Real throwaway Postgres (TEST_DATABASE_URL); mail is never configured here.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import pytest

from tests.test_qa_e2e_db import _fresh_rate_limits, _signup, world  # noqa: F401  (fixtures are used by name)
from tests.test_qa_routes_db import _apply

pytestmark = pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not set")


def _sql(query: str, args: tuple = ()) -> None:
    import psycopg

    with psycopg.connect(os.environ["TEST_DATABASE_URL"]) as conn:
        conn.execute(query, args)


def _status(client, org, **params):
    return client.get("/api/vendor/interview-invites", params=params, headers=org["h"])


def _schedule(client, world, app_id, when):
    res = client.post(
        f"/api/vendor/applicants/{app_id}/interview-invite",
        json={"scheduledStart": when.isoformat(), "durationMinutes": 30},
        headers=world["a"]["h"],
    )
    assert res.status_code == 201, res.text
    return res.json()["invite"]


def test_recruiter_sees_sent_then_opened_and_the_url(client, world):
    sent = client.post(
        "/api/vendor/interview-invites/send",
        json={"candidates": [{"email": "sneha@example.com", "name": "Sneha"}], "jobId": world["job"]["id"]},
        headers=world["a"]["h"],
    )
    assert sent.status_code == 201, sent.text
    url = sent.json()["invites"][0]["inviteUrl"]
    token = url.rsplit("/", 1)[1]

    [row] = _status(client, world["a"], jobId=world["job"]["id"]).json()["invites"]
    assert row["state"] == "sent" and row["openLink"] is True
    assert row["inviteUrl"].endswith(f"/interview/invite/{token}")
    assert row["candidateEmail"] == "sneha@example.com"

    # The recruiter previewing their own link does not count as "opened".
    client.get(f"/api/interview-invites/{token}", headers=world["a"]["h"])
    assert _status(client, world["a"]).json()["invites"][0]["state"] == "sent"
    # The candidate opening it (signed out) does.
    assert client.get(f"/api/interview-invites/{token}").status_code == 200
    row = _status(client, world["a"]).json()["invites"][0]
    assert row["state"] == "opened" and row["openedAt"]


def test_scheduled_invite_is_booked_and_expired_after_its_window(client, world):
    app_id = _apply(client, world)["applicationId"]
    inv = _schedule(client, world, app_id, datetime.now(timezone.utc) + timedelta(days=2))
    [row] = _status(client, world["a"], applicationId=app_id).json()["invites"]
    assert row["state"] == "booked" and row["openLink"] is False
    assert row["scheduledStart"] == inv["scheduledStart"]
    _sql(
        "UPDATE interview_invites SET scheduled_start = NOW() - INTERVAL '3 days', scheduled_end = NOW() - INTERVAL '3 days' + INTERVAL '15 minutes' WHERE token = %s",
        (inv["token"],),
    )
    assert _status(client, world["a"], applicationId=app_id).json()["invites"][0]["state"] == "expired"


def test_invites_are_organisation_scoped(client, world):
    app_id = _apply(client, world)["applicationId"]
    _schedule(client, world, app_id, datetime.now(timezone.utc) + timedelta(days=2))
    assert len(_status(client, world["a"]).json()["invites"]) == 1
    # Another organisation sees none of them, by any filter, and cannot name the other org's job.
    assert _status(client, world["b"]).json()["invites"] == []
    assert _status(client, world["b"], applicationId=app_id).json()["invites"] == []
    assert _status(client, world["b"], email=world["cand"]["email"]).json()["invites"] == []
    assert _status(client, world["b"], jobId=world["job"]["id"]).status_code == 404
    # Candidates and anonymous callers cannot list invites at all.
    assert client.get("/api/vendor/interview-invites").status_code == 401
    assert _status(client, world["cand"]).status_code in (401, 403)


def test_reminders_with_email_off_are_recorded_and_shown_as_due(client, world, monkeypatch):
    app_id = _apply(client, world)["applicationId"]
    inv = _schedule(client, world, app_id, datetime.now(timezone.utc) + timedelta(hours=1, minutes=30))
    # Booked a moment ago is quiet: backdate it so the 2h reminder is due.
    _sql("UPDATE interview_invites SET created_at = NOW() - INTERVAL '2 days' WHERE token = %s", (inv["token"],))
    monkeypatch.setenv("CRON_SECRET", "qa-cron-secret")
    assert client.post("/api/internal/interview-reminders").status_code == 401
    assert client.post("/api/internal/interview-reminders", headers={"x-cron-secret": "nope"}).status_code == 401

    h = {"x-cron-secret": "qa-cron-secret"}
    first = client.post("/api/internal/interview-reminders", headers=h)
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["emailConfigured"] is False and body["recorded"]["2h"] == 1 and body["sent"]["2h"] == 0
    # Recorded once per slot.
    assert client.post("/api/internal/interview-reminders", headers=h).json()["recorded"] == {"24h": 0, "2h": 0}

    [row] = _status(client, world["a"], applicationId=app_id).json()["invites"]
    assert row["reminderDue"] is True
    assert row["reminder"]["kind"] == "2h" and row["reminder"]["channel"] == "in_app"
    # The candidate's invite page gets it too; someone else holding the link does not.
    mine = client.get(f"/api/interview-invites/{inv['token']}", headers=world["cand"]["h"]).json()["invite"]
    assert mine["reminder"]["kind"] == "2h"
    assert client.get(f"/api/interview-invites/{inv['token']}").json()["invite"]["reminder"] is None
