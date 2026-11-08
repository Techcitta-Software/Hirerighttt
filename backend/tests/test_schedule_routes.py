"""Slot reminders (24h / 2h) and candidate self-service rescheduling rules."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.dispatch.schedule_routes import MAX_RESCHEDULES, reminder_kind, reschedule_refusal
from app.services.interview_invites import INVITE_JOIN_WINDOW_MINUTES

NOW = datetime(2026, 11, 8, 10, 0, tzinfo=timezone.utc)


def _invite(start_in: timedelta, **extra) -> dict:
    start = NOW + start_in
    return {
        "token": "tok",
        "candidate_email": "c@example.com",
        "scheduled_start": start,
        "scheduled_end": start + timedelta(minutes=15),
        "created_at": NOW - timedelta(days=3),
        "created_by_user_id": "u1",
        "application_id": None,
        **extra,
    }


def test_join_window_defaults_to_15_minutes_or_env() -> None:
    assert 1 <= INVITE_JOIN_WINDOW_MINUTES <= 30


def test_24h_reminder_window() -> None:
    assert reminder_kind(_invite(timedelta(hours=23)), NOW) == "24h"
    assert reminder_kind(_invite(timedelta(hours=23), reminder_24h_sent_at=NOW), NOW) is None
    assert reminder_kind(_invite(timedelta(hours=30)), NOW) is None


def test_2h_reminder_window() -> None:
    assert reminder_kind(_invite(timedelta(minutes=90)), NOW) == "2h"
    assert reminder_kind(_invite(timedelta(minutes=90), reminder_2h_sent_at=NOW), NOW) is None


def test_no_reminder_after_start_or_right_after_booking() -> None:
    assert reminder_kind(_invite(-timedelta(minutes=1)), NOW) is None
    just_booked = _invite(timedelta(minutes=90), created_at=NOW - timedelta(minutes=10))
    assert reminder_kind(just_booked, NOW) is None


def test_open_links_are_not_slot_bookings() -> None:
    open_link = _invite(timedelta(hours=3))
    open_link["scheduled_end"] = open_link["scheduled_start"] + timedelta(days=7)
    assert reminder_kind(open_link, NOW) is None


def test_candidate_can_move_their_own_booking() -> None:
    user = {"id": "u1", "email": "c@example.com"}
    assert reschedule_refusal(_invite(timedelta(hours=5)), user, {"interviewSessions": {}}) is None


def test_reschedule_refusals() -> None:
    user = {"id": "u1", "email": "c@example.com"}
    other = {"id": "u2", "email": "x@example.com"}
    assert "email address" in reschedule_refusal(_invite(timedelta(hours=5)), other, {})
    assert "recruiter" in reschedule_refusal(_invite(timedelta(hours=5), application_id="app1"), user, {})
    assert "times" in reschedule_refusal(_invite(timedelta(hours=5), reschedule_count=MAX_RESCHEDULES), user, {})
    done = {"interviewSessions": {"s": {"inviteToken": "tok", "status": "completed"}}}
    assert "completed" in reschedule_refusal(_invite(timedelta(hours=5)), user, done)


def test_reminder_endpoint_requires_the_cron_secret(client: TestClient, monkeypatch) -> None:
    monkeypatch.setenv("CRON_SECRET", "s3cret-value")
    assert client.post("/api/internal/interview-reminders").status_code == 401
    assert client.post("/api/internal/interview-reminders", headers={"X-Cron-Secret": "wrong"}).status_code == 401


def test_reschedule_requires_sign_in(client: TestClient) -> None:
    res = client.post("/api/interview-invites/abc123/reschedule", json={"scheduledStart": "2030-01-01T10:00:00Z"})
    assert res.status_code == 401
