"""Face-tracker review events: detector metadata, final-sync races and which deviations cost points."""

from __future__ import annotations

from app.services.interview_integrity import merge_server_integrity
from app.services.proctoring.review_events import combine_review_logs, merge_review_events, timeline_events
from app.services.proctoring.score_penalty import PENALTY_MIN_DURATION_SEC, count_face_proctor_deviations


def _ev(i="g1", **over):
    base = {
        "id": i,
        "eventType": "SIDE_GAZE_LOOKING_AWAY",
        "startOffsetSec": 30.0,
        "durationSec": 6.0,
        "timestamp": "2026-11-20T10:00:00Z",
        "formattedTime": "0:30",
        "message": "Eyes looking to the side",
    }
    return {**base, **over}


def test_confidence_and_level_are_kept_and_sanitised():
    [saved] = merge_review_events([], [_ev(confidence=0.874, level="high")])
    assert saved["confidence"] == 0.874 and saved["level"] == "high"
    [clamped] = merge_review_events([], [_ev(confidence=7, level="extreme")])
    assert clamped["confidence"] == 1.0 and "level" not in clamped
    [nan] = merge_review_events([], [_ev(confidence=float("nan"))])
    assert "confidence" not in nan


def test_combined_logs_keep_the_longer_duration_and_client_only_events():
    server = [_ev(durationSec=2.0)]  # last periodic sync, interval still open
    client = [_ev(durationSec=6.0), _ev("g2", eventType="NO_FACE_SEEN", startOffsetSec=50, durationSec=4)]
    out = {e["id"]: e for e in combine_review_logs(server, client)}
    assert out["g1"]["durationSec"] == 6.0
    assert out["g2"]["eventType"] == "NO_FACE_SEEN"
    # A server copy that is already longer is not shortened.
    out = {e["id"]: e for e in combine_review_logs([_ev(durationSec=9)], [_ev(durationSec=6)])}
    assert out["g1"]["durationSec"] == 9


def test_scoring_merge_does_not_cut_an_open_interval_short():
    session = {"reviewEvents": [_ev(durationSec=2.0)]}
    merged = merge_server_integrity(session, {"logs": [_ev(durationSec=6.0)]})
    assert [e["durationSec"] for e in merged["logs"]] == [6.0]


def test_timeline_events_whitelist_fields_from_client_copies():
    [e] = timeline_events([_ev(confidence=0.9, evil="<script>", message="x" * 900)])
    assert "evil" not in e
    assert len(e["message"]) == 500
    assert e["confidence"] == 0.9
    assert (e["startOffsetMs"], e["endOffsetMs"]) == (30000, 36000)
    assert timeline_events([_ev(id=None)]) == []


def test_only_sustained_deviations_cost_points():
    short = PENALTY_MIN_DURATION_SEC - 1
    logs = [
        _ev("a", durationSec=short),  # brief look-away: on the timeline, no penalty
        _ev("b", durationSec=PENALTY_MIN_DURATION_SEC),
        _ev("c", eventType="NO_FACE_SEEN", durationSec=short),
        _ev("d", eventType="MULTIPLE_FACES_DETECTED", durationSec=1.5),  # always counts
    ]
    assert count_face_proctor_deviations({"logs": logs, "flaggedSections": []}) == 2
    sections = [
        {"type": "LOOKING_SIDE", "startSec": 10, "endSec": 11.6, "durationSec": 1.6},
        {"type": "LOOKING_SIDE", "startSec": 20, "endSec": 26, "durationSec": 6},
        {"type": "MULTI_FACE", "startSec": 40, "endSec": 41.5, "durationSec": 1.5},
        {"type": "NO_FACE", "startSec": 50, "endSec": 55},  # no durationSec: derived from start/end
    ]
    assert count_face_proctor_deviations({"flaggedSections": sections}) == 3


from tests.test_proctor_timeline import _review, mem_db  # noqa: E402,F401  (fixture reuse)


def test_reviewer_timeline_includes_events_that_only_arrived_with_the_scored_result(client, mem_db):  # noqa: F811
    session = mem_db["interviewSessions"]["sess-a"]
    session["reviewEvents"] = merge_review_events([], [_ev(durationSec=2.0)])
    session["result"] = {
        "integrity": {"logs": [_ev(durationSec=6.0), _ev("late", eventType="NO_FACE_SEEN", startOffsetSec=80, durationSec=5)]}
    }
    res = _review(client, "org-a")
    assert res.status_code == 200, res.text
    assert [(e["id"], e["startOffsetMs"], e["endOffsetMs"]) for e in res.json()["events"]] == [
        ("g1", 30000, 36000),
        ("late", 80000, 85000),
    ]
