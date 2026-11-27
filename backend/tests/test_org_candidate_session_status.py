"""Organisation candidate rows carry the latest interview session status without reordering."""

from app.dispatch.api_dispatch import _attach_interview_session_status


def test_latest_session_status_is_active_and_order_is_kept():
    db = {
        "interviewSessions": {
            "old": {
                "email": "a@x.com",
                "organizationId": "org-1",
                "status": "completed",
                "startedAt": "2026-01-01T00:00:00Z",
            },
            "live": {
                "email": "a@x.com",
                "organizationId": "org-1",
                "status": "active",
                "startedAt": "2026-06-01T00:00:00Z",
            },
            "other-org": {
                "email": "a@x.com",
                "organizationId": "org-2",
                "status": "active",
                "startedAt": "2026-07-01T00:00:00Z",
            },
            "pending": {
                "email": "b@x.com",
                "organizationId": "org-1",
                "status": "pending",
                "createdAt": "2026-05-01T00:00:00Z",
            },
        }
    }
    payload = {
        "total": 3,
        "candidates": [
            {"candidateEmail": "b@x.com", "candidateName": "B"},
            {"candidateEmail": "a@x.com", "candidateName": "A"},
            {"candidateEmail": "c@x.com", "candidateName": "C"},
        ],
    }
    out = _attach_interview_session_status(db, "org-1", payload)
    assert [row["candidateEmail"] for row in out["candidates"]] == ["b@x.com", "a@x.com", "c@x.com"]
    assert out["candidates"][0]["interviewSessionStatus"] == "pending"
    assert out["candidates"][1]["interviewSessionStatus"] == "active"
    assert "interviewSessionStatus" not in out["candidates"][2]
    assert out["total"] == 3
