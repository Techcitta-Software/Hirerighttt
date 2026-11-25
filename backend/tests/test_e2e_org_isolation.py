"""Cross-org access to candidate data.

OWNER DECISION (reverses the earlier V-05 contact / report restriction): any employer sees the e-mail, phone, resume
and FULL interview report of every employer-visible candidate (applicants of its jobs and job seekers on the
Candidates list). What stays private: candidates who hid their profile ("private" / "organization_only") and have no
link to the organization are not returned at all.
"""

from __future__ import annotations

from app.services.vendor.candidate_documents import redact_roster_rows, redact_talent_hits

FULL_REPORT = {
    "overall": 11,
    "role": "Backend Engineer (Payments)",
    "answers": [{"question": "Q?", "answer": "my answer", "feedback": "off-topic"}],
    "integrity": {"logs": [{"eventType": "NO_FACE_SEEN"}]},
    "sessionId": "sess-1",
}


def _db():
    return {
        "users": [],
        "profiles": {
            "pub@x.com": {"profileVisibility": "marketplace"},
            "priv@x.com": {"profileVisibility": "private"},
            "orgonly@x.com": {"profileVisibility": "organization_only"},
        },
    }


def test_platform_row_keeps_full_report_and_contact():
    rows = [
        {"source": "application", "candidateEmail": "k@x.com", "candidatePhone": "1", "interviewResult": FULL_REPORT},
        {"source": "platform", "candidateEmail": "pub@x.com", "candidatePhone": "2", "interviewResult": FULL_REPORT},
    ]
    out = redact_roster_rows(_db(), rows)
    assert [r["candidateEmail"] for r in out] == ["k@x.com", "pub@x.com"]
    assert all(r["contactHidden"] is False for r in out)
    assert out[1]["candidatePhone"] == "2"
    assert out[1]["interviewResult"]["answers"][0]["answer"] == "my answer"
    assert out[1]["interviewResult"]["sessionId"] == "sess-1" and "integrity" in out[1]["interviewResult"]
    assert "reportRestricted" not in out[1]["interviewResult"]


def test_hidden_profiles_without_link_are_dropped_linked_ones_kept():
    rows = [
        {"source": "platform", "candidateEmail": "priv@x.com", "interviewResult": FULL_REPORT},
        {"source": "talent", "candidateEmail": "orgonly@x.com"},
        {"source": "application", "candidateEmail": "priv@x.com", "interviewResult": FULL_REPORT},
    ]
    out = redact_roster_rows(_db(), rows)
    assert len(out) == 1 and out[0]["source"] == "application"


def test_talent_hits_keep_email_and_preview():
    hits = [{"userId": "u1", "email": "pub@x.com", "resumePreview": "Python dev", "resumeSnippet": "Python"}]
    out = redact_talent_hits(_db(), "org-b", hits)
    assert out[0]["email"] == "pub@x.com" and out[0]["resumePreview"] == "Python dev"
    assert out[0]["contactHidden"] is False
