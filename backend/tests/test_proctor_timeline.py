"""Proctoring deviation events for the recording timeline: capture validation, offsets, caps and who may read them."""

from __future__ import annotations

import math

import pytest
from fastapi import HTTPException

from app.node_config import config
from app.server import runtime
from app.services.proctoring.persist_flags import review_logs_to_flag_sections
from app.services.proctoring.review_events import (
    MAX_EVENTS_PER_BATCH,
    MAX_EVENTS_PER_SESSION,
    MAX_OFFSET_SEC,
    merge_review_events,
    timeline_events,
)
from app.services.proctoring.score_penalty import count_face_proctor_deviations


def _ev(i: int | str = 1, **over) -> dict:
    base = {
        "id": f"ev-{i}",
        "eventType": "SIDE_GAZE_LOOKING_AWAY",
        "startOffsetSec": 12.5,
        "durationSec": 4.25,
        "timestamp": "2026-11-20T10:00:00Z",
        "formattedTime": "0:12",
        "message": "Face the camera",
    }
    return {**base, **over}


# ── capture / merge ───────────────────────────────────────────────────────────


def test_events_are_saved_with_millisecond_offsets_from_the_recording_start():
    [saved] = merge_review_events([], [_ev()])
    assert saved["startOffsetSec"] == 12.5
    assert saved["startOffsetMs"] == 12500
    assert saved["endOffsetMs"] == 16750
    assert saved["severity"] == "warn" and saved["reviewOnly"] is True


def test_continuous_events_grow_their_end_offset_on_later_syncs():
    first = merge_review_events([], [_ev(durationSec=4)])
    second = merge_review_events(first, [_ev(durationSec=9)])
    assert second[0]["durationSec"] == 9
    assert second[0]["endOffsetMs"] == 21500
    # A stale sync can never shorten an interval the server already has.
    third = merge_review_events(second, [_ev(durationSec=2)])
    assert third[0]["durationSec"] == 9


def test_instant_lockdown_events_keep_severity_and_have_equal_start_and_end():
    [saved] = merge_review_events(
        [], [_ev(eventType="TAB_OR_WINDOW_LEFT", durationSec=0, severity="block", reviewOnly=False)]
    )
    assert saved["severity"] == "block" and saved["reviewOnly"] is False
    assert saved["startOffsetMs"] == saved["endOffsetMs"] == 12500


def test_behaviour_events_are_accepted_but_never_change_the_score():
    events = merge_review_events(
        [],
        [_ev(1, eventType="EXCESSIVE_MOVEMENT"), _ev(2, eventType="PHONE_DETECTED", startOffsetSec=30)],
    )
    assert {e["eventType"] for e in events} == {"EXCESSIVE_MOVEMENT", "PHONE_DETECTED"}
    # Not flagged sections and not deviations: scoring stays exactly as before.
    assert review_logs_to_flag_sections(events) == []
    assert count_face_proctor_deviations({"logs": events, "flaggedSections": []}) == 0


@pytest.mark.parametrize(
    "bad",
    [
        _ev(eventType="NOT_A_REAL_TYPE"),
        _ev(eventType="<script>"),
        _ev(id=""),
        _ev(id="x" * 101),
        _ev(id=7),
        _ev(startOffsetSec=-1),
        _ev(startOffsetSec=float("nan")),
        _ev(startOffsetSec=float("inf")),
        _ev(startOffsetSec=True),
        _ev(startOffsetSec="12"),
        _ev(startOffsetSec=MAX_OFFSET_SEC + 1),
        _ev(durationSec=-3),
        _ev(durationSec=math.nan),
        _ev(timestamp="yesterday"),
        {k: v for k, v in _ev().items() if k != "timestamp"},
        "not-an-object",
        None,
    ],
)
def test_malformed_or_unknown_events_are_rejected(bad):
    with pytest.raises(ValueError):
        merge_review_events([], [bad])


def test_batch_must_be_a_bounded_list():
    with pytest.raises(ValueError):
        merge_review_events([], {"id": "x"})  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        merge_review_events([], [_ev(i) for i in range(MAX_EVENTS_PER_BATCH + 1)])


def test_text_fields_are_truncated_and_durations_clamped_to_the_cap():
    [saved] = merge_review_events(
        [], [_ev(message="m" * 5000, formattedTime="t" * 99, startOffsetSec=MAX_OFFSET_SEC - 10, durationSec=1e9)]
    )
    assert len(saved["message"]) == 500 and len(saved["formattedTime"]) == 30
    assert saved["startOffsetSec"] + saved["durationSec"] == MAX_OFFSET_SEC


def test_session_event_count_is_capped_without_breaking_later_syncs():
    full = merge_review_events([], [_ev(i, startOffsetSec=i) for i in range(MAX_EVENTS_PER_SESSION)])
    assert len(full) == MAX_EVENTS_PER_SESSION
    # New events past the cap are dropped, but known events still update and the call does not fail.
    after = merge_review_events(full, [_ev("new", startOffsetSec=5000), _ev(0, startOffsetSec=0, durationSec=99)])
    assert len(after) == MAX_EVENTS_PER_SESSION
    assert "ev-new" not in {e["id"] for e in after}
    assert next(e for e in after if e["id"] == "ev-0")["durationSec"] == 99


def test_event_identity_cannot_be_rewritten():
    saved = merge_review_events([], [_ev()])
    with pytest.raises(ValueError):
        merge_review_events(saved, [_ev(startOffsetSec=1)])
    with pytest.raises(ValueError):
        merge_review_events(saved, [_ev(eventType="NO_FACE_SEEN")])


def test_candidate_explanations_survive_a_resync():
    saved = merge_review_events([], [_ev()])
    saved[0]["candidateExplanation"] = "My dog barked"
    saved[0]["explainedAt"] = "2026-11-20T10:05:00Z"
    again = merge_review_events(saved, [_ev(durationSec=6)])
    assert again[0]["candidateExplanation"] == "My dog barked"
    assert again[0]["explainedAt"] == "2026-11-20T10:05:00Z"


def test_timeline_events_backfill_offsets_for_old_sessions_and_drop_junk():
    legacy = [
        {"id": "b", "eventType": "NO_FACE_SEEN", "startOffsetSec": 40, "durationSec": 3},
        {"id": "a", "eventType": "SIDE_GAZE_LOOKING_AWAY", "startOffsetSec": 5.5},
        {"id": "junk", "eventType": "HACKED", "startOffsetSec": 1, "durationSec": 1},
        {"id": "neg", "eventType": "NO_FACE_SEEN", "startOffsetSec": -4, "durationSec": 1},
        "nonsense",
    ]
    out = timeline_events(legacy)
    assert [e["id"] for e in out] == ["a", "b"]
    assert out[0]["startOffsetMs"] == 5500 and out[0]["endOffsetMs"] == 5500
    assert out[1]["startOffsetMs"] == 40000 and out[1]["endOffsetMs"] == 43000
    assert timeline_events(None) == []


# ── HTTP: only the owner (candidate) and authorised reviewers can read them ──


@pytest.fixture
def mem_db(monkeypatch):
    # These HTTP tests drive the in-memory store. When TEST_DATABASE_URL is set, switch the app to the
    # in-memory store for the duration of the test instead of skipping.
    saved_url = config.database_url
    object.__setattr__(config, "database_url", "")
    try:
        yield from _mem_db_body(monkeypatch)
    finally:
        object.__setattr__(config, "database_url", saved_url)


def _mem_db_body(monkeypatch):
    db = {
        "users": [
            {"id": "u-cand", "email": "cand@example.com", "role": "jobseeker", "status": "active"},
            {"id": "u-other", "email": "other@example.com", "role": "jobseeker", "status": "active"},
        ],
        "interviewSessions": {
            "sess-a": {
                "email": "cand@example.com",
                "organizationId": "org-a",
                "status": "in_progress",
                "reviewEvents": [],
            }
        },
        "employerApplications": [
            {"id": "app-1", "organizationId": "org-a", "candidateEmail": "cand@example.com", "jobId": "job-1"}
        ],
    }
    monkeypatch.setattr(runtime, "_db_cache", db)

    async def fake_auth(request):
        email = request.headers.get("x-test-user")
        if not email:
            raise HTTPException(status_code=401, detail="Unauthorized")
        return email

    async def fake_employer(request, _db):
        org = request.headers.get("x-test-org")
        if not org:
            raise HTTPException(status_code=401, detail="Unauthorized")
        return {
            "user": {"id": f"u-{org}", "email": f"hr@{org}.example", "status": "active", "role": "employer"},
            "tenant": {
                "organization": {"id": org, "status": "active"},
                "membership": {"role": request.headers.get("x-test-role") or "admin"},
            },
        }

    monkeypatch.setattr(runtime, "require_auth_email", fake_auth)
    monkeypatch.setattr(runtime, "require_employer_tenant", fake_employer)
    yield db


def _post(client, user, events, session_id="sess-a"):
    return client.post(
        "/api/interview/review-events",
        json={"sessionId": session_id, "events": events},
        headers={"x-test-user": user},
    )


def test_candidate_saves_events_to_their_own_session(client, mem_db):
    res = _post(client, "cand@example.com", [_ev(), _ev(2, eventType="PHONE_DETECTED", startOffsetSec=60)])
    assert res.status_code == 200, res.text
    stored = mem_db["interviewSessions"]["sess-a"]["reviewEvents"]
    assert [e["startOffsetMs"] for e in stored] == [12500, 60000]


def test_bad_batches_are_refused_over_http(client, mem_db):
    assert _post(client, "cand@example.com", [_ev(eventType="DROP TABLE")]).status_code == 400
    assert _post(client, "cand@example.com", [_ev(startOffsetSec=-5)]).status_code == 400
    assert mem_db["interviewSessions"]["sess-a"]["reviewEvents"] == []


def test_another_candidate_cannot_write_or_read_the_events(client, mem_db):
    _post(client, "cand@example.com", [_ev()])
    assert _post(client, "other@example.com", [_ev(9)]).status_code == 404
    res = client.get("/api/interview/review-events?sessionId=sess-a", headers={"x-test-user": "other@example.com"})
    assert res.status_code == 404
    assert [e["id"] for e in mem_db["interviewSessions"]["sess-a"]["reviewEvents"]] == ["ev-1"]


def _review(client, org, role="admin"):
    return client.get(
        "/api/vendor/interview-review?sessionId=sess-a&email=cand@example.com",
        headers={"x-test-org": org, "x-test-role": role},
    )


def test_reviewer_in_the_owning_organisation_gets_the_timeline_events(client, mem_db):
    _post(client, "cand@example.com", [_ev(), _ev(2, eventType="TAB_OR_WINDOW_LEFT", startOffsetSec=90, durationSec=0)])
    res = _review(client, "org-a")
    assert res.status_code == 200, res.text
    body = res.json()
    assert [(e["eventType"], e["startOffsetMs"], e["endOffsetMs"]) for e in body["events"]] == [
        ("SIDE_GAZE_LOOKING_AWAY", 12500, 16750),
        ("TAB_OR_WINDOW_LEFT", 90000, 90000),
    ]
    assert "recordingDurationSec" in body


def test_other_organisations_cannot_fetch_the_events(client, mem_db):
    _post(client, "cand@example.com", [_ev()])
    res = _review(client, "org-b")
    assert res.status_code == 404
    assert "events" not in res.json()


def test_non_reviewer_roles_cannot_fetch_the_events(client, mem_db):
    _post(client, "cand@example.com", [_ev()])
    res = _review(client, "org-a", role="viewer")
    assert res.status_code == 403
    assert "events" not in res.json()


def test_unauthenticated_requests_are_refused(client, mem_db):
    assert client.get("/api/vendor/interview-review?sessionId=sess-a&email=cand@example.com").status_code == 401
    assert client.post("/api/interview/review-events", json={"sessionId": "sess-a", "events": []}).status_code == 401


def test_review_without_video_still_returns_events_and_interview_length(client, mem_db):
    # No recording saved (e.g. the upload failed): the reviewer still gets the events plus the interview's length so
    # the face-gaze bar can be drawn on interview time.
    mem_db["interviewSessions"]["sess-a"].update(
        {"startedAt": "2026-11-20T10:00:00Z", "completedAt": "2026-11-20T10:06:30Z"}
    )
    _post(client, "cand@example.com", [_ev(), _ev(2, eventType="NO_FACE_SEEN", startOffsetSec=200, durationSec=3)])
    body = _review(client, "org-a").json()
    assert body["videoUrl"] is None
    assert body["interviewDurationSec"] == 390
    assert [e["startOffsetMs"] for e in body["events"]] == [12500, 200000]


def test_interview_length_is_none_when_the_session_has_no_times(client, mem_db):
    body = _review(client, "org-a").json()
    assert body["interviewDurationSec"] is None
