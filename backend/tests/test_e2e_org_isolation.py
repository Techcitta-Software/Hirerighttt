"""E2E journey regressions (cross-org isolation).

Found in the full recruiter -> candidate -> recruiter journey: a second organization with no link to the candidate
got the candidate's whole interview report (every answer, per-question feedback, proctoring logs and the recording
session id) in the platform roster (/api/vendor/candidates) and in /api/talent/candidates/{id}. Discovery may show the
score; the report belongs to organizations the candidate applied to / was invited or interviewed by.
"""

from __future__ import annotations

from app.services.vendor.candidate_documents import (
    discovery_interview_summary,
    hide_roster_contact,
    redact_roster_rows,
)

FULL_REPORT = {
    "overall": 11,
    "role": "Backend Engineer (Payments)",
    "level": "3-5 years",
    "date": "2026-11-23T03:16:37Z",
    "categories": [{"label": "Depth", "score": 24}],
    "scoring": {"reliable": True},
    "answers": [{"question": "Q?", "answer": "my private answer", "feedback": "off-topic"}],
    "strengths": ["Payment Ledger: strong"],
    "improvements": ["REST: no answer"],
    "integrity": {"logs": [{"eventType": "NO_FACE_SEEN"}]},
    "sessionId": "sess-1",
    "scoreModel": {"rows": []},
    "roleSkillsAnalysis": {"fitScore": 20},
}


def test_discovery_summary_keeps_score_drops_report():
    out = discovery_interview_summary(FULL_REPORT)
    assert out["overall"] == 11 and out["role"] == FULL_REPORT["role"] and out["categories"] == FULL_REPORT["categories"]
    assert out["answers"] == [] and out["strengths"] == [] and out["improvements"] == []
    for leaked in ("integrity", "sessionId", "scoreModel", "roleSkillsAnalysis"):
        assert leaked not in out
    assert out["reportRestricted"] is True
    assert "my private answer" not in repr(out)
    assert discovery_interview_summary(None) is None


def test_unlinked_roster_row_loses_report_linked_row_keeps_it():
    unlinked = hide_roster_contact({"source": "platform", "candidateEmail": "k@x.com", "interviewResult": FULL_REPORT})
    assert unlinked["contactHidden"] is True and unlinked["interviewResult"]["overall"] == 11
    assert "my private answer" not in repr(unlinked) and "sess-1" not in repr(unlinked)

    db = {"profiles": {}, "users": []}
    rows = [
        {"source": "application", "candidateEmail": "k@x.com", "interviewResult": FULL_REPORT},
        {"source": "platform", "candidateEmail": "k@x.com", "interviewResult": FULL_REPORT},
    ]
    out = redact_roster_rows(db, rows)
    assert out[0]["interviewResult"]["answers"][0]["answer"] == "my private answer"  # applied to this org
    assert out[1]["interviewResult"]["answers"] == []  # platform roster, no link
