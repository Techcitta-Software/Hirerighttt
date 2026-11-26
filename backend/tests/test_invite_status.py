"""Invite state rules for the recruiter's invite status (no database)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.services.vendor.invite_status import invite_state, reminder_info

NOW = datetime(2026, 11, 26, 10, 0, tzinfo=timezone.utc)


def _inv(start: timedelta, length: timedelta, **over) -> dict:
    return {"token": "t", "scheduled_start": NOW + start, "scheduled_end": NOW + start + length, **over}


def test_open_link_is_sent_then_opened():
    inv = _inv(timedelta(minutes=-1), timedelta(days=7), context_json={"openInvite": True})
    assert invite_state(inv, [], NOW) == "sent"
    assert invite_state({**inv, "opened_at": NOW}, [], NOW) == "opened"


def test_slot_is_booked_until_it_expires():
    slot = _inv(timedelta(days=1), timedelta(minutes=15))
    assert invite_state(slot, [], NOW) == "booked"
    assert invite_state(slot, [], NOW + timedelta(days=2)) == "expired"


def test_sessions_win_over_the_schedule():
    slot = _inv(timedelta(days=-3), timedelta(minutes=15))
    assert invite_state(slot, ["in_progress"], NOW) == "started"
    assert invite_state(slot, ["in_progress", "completed"], NOW) == "completed"


def test_reminder_prefers_the_email_actually_sent_over_the_in_app_record():
    assert reminder_info({}) is None
    assert reminder_info({"reminder_due_kind": "24h", "reminder_due_at": NOW})["channel"] == "in_app"
    sent = reminder_info({"reminder_2h_sent_at": NOW, "reminder_due_kind": "2h"})
    assert sent["kind"] == "2h" and sent["channel"] == "email"
