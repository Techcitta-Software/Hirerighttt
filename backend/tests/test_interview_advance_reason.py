"""Every saved answer records WHY the question moved on (answered / skipped / time up …), so skips can be diagnosed."""

from __future__ import annotations

from app.services import interview_session_lifecycle as ivlife
from tests.test_interview_session_lifecycle import _start, batch_calls  # noqa: F401  (pytest fixture)
from tests.test_security_fixes import _auth, env  # noqa: F401  (pytest fixture)


def test_record_answer_keeps_known_advance_reasons_only():
    session = {"questions": [{"text": "Q1 about APIs"}, {"text": "Q2 about caching"}]}
    ivlife.record_answer(session, 0, None, "An answer", advance_reason="voice-complete")
    ivlife.record_answer(session, 1, None, "", advance_reason="skip")
    assert [t["advanceReason"] for t in session["history"]] == ["voice-complete", "skip"]
    ivlife.record_answer(session, 1, None, "", advance_reason="<script>")
    assert "advanceReason" not in session["history"][1]
    ivlife.record_answer(session, 1, None, "late answer")  # old clients: no reason, still saved
    assert session["history"][1]["answer"] == "late answer"


def test_answer_endpoint_stores_the_advance_reason(env, batch_calls):  # noqa: F811
    client, db, _pool = env
    started = _start(client).json()
    sid = started["sessionId"]
    res = client.post(
        "/api/interview/answer",
        headers=_auth("tok-cand"),
        json={"sessionId": sid, "questionIndex": 0, "question": started["questions"][0], "answer": "", "advanceReason": "time-up"},
    )
    assert res.status_code == 200, res.text
    assert db["interviewSessions"][sid]["history"][0]["advanceReason"] == "time-up"
