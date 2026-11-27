"""Interview session lifecycle (T5 B9/B11/B12, T1 slot lock, T3 #1 invite linking).

- Opening the waiting room prepares a `pending` session: it never claims the free career interview, and a second
  waiting-room load reuses it (no second question-generation call).
- The free interview is claimed on entering the room / the first answer.
- A reload mid-interview resumes the same session with the same questions and the recorded answers.
- An interview left for more than 6 hours is marked abandoned and the candidate is told.
- A booked slot locks the career interview on the server, in every tab.
- An open job invite links the interview to the job's application (created when missing).
No real database, LLM or mail is used.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.dispatch import api_dispatch
from app.services import interview_session_lifecycle as ivlife
from tests.test_security_fixes import CONSENT, _auth, env  # noqa: F401  (pytest fixture)


def _iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


@pytest.fixture
def batch_calls(monkeypatch):
    calls: list[dict] = []

    async def fake_batch(payload):
        calls.append(payload)
        n = len(calls)
        qs = [{"text": f"Batch {n} question {i} about your resume work in detail?", "category": "Technical"} for i in range(1, 7)]
        return {"questions": qs, "totalTurns": 6}

    monkeypatch.setattr(api_dispatch.ia, "generate_adaptive_question_batch", fake_batch)
    return calls


def _start(client, **body):
    return client.post("/api/interview/start", headers=_auth("tok-cand"), json={"consent": CONSENT, "role": "Dev", **body})


def test_waiting_room_load_claims_nothing_and_is_reused(env, batch_calls):
    client, db, pool = env
    first = _start(client)
    assert first.status_code == 200, first.text
    sid = first.json()["sessionId"]
    assert db["interviewSessions"][sid]["status"] == "pending"
    assert pool.state["free"] == set()  # B11: the free interview is still available
    # B12: reloading the waiting room returns the same prepared session, no second generation call.
    again = _start(client)
    assert again.json()["sessionId"] == sid and again.json()["questions"] == first.json()["questions"]
    assert len(batch_calls) == 1
    assert len(db["interviewSessions"]) == 1


def test_entering_the_room_claims_the_free_interview_once(env, batch_calls):
    client, db, pool = env
    sid = _start(client).json()["sessionId"]
    res = client.post("/api/interview/enter", headers=_auth("tok-cand"), json={"sessionId": sid})
    assert res.status_code == 200, res.text
    assert pool.state["free"] == {"cand@example.com"}
    session = db["interviewSessions"][sid]
    assert session["status"] == "active" and session["billing"] == "free" and session["enteredAt"]
    # Entering twice (double click / retry) is idempotent.
    assert client.post("/api/interview/enter", headers=_auth("tok-cand"), json={"sessionId": sid}).status_code == 200


def test_first_answer_also_activates_a_pending_session(env, batch_calls):
    client, db, pool = env
    started = _start(client).json()
    res = client.post(
        "/api/interview/answer",
        headers=_auth("tok-cand"),
        json={"sessionId": started["sessionId"], "questionIndex": 0, "question": started["questions"][0], "answer": "My answer"},
    )
    assert res.status_code == 200, res.text
    assert db["interviewSessions"][started["sessionId"]]["status"] == "active"
    assert pool.state["free"] == {"cand@example.com"}


def test_reload_mid_interview_resumes_the_same_session_with_answers(env, batch_calls):
    client, db, pool = env
    started = _start(client).json()
    sid, questions = started["sessionId"], started["questions"]
    client.post("/api/interview/enter", headers=_auth("tok-cand"), json={"sessionId": sid})
    for i, text in enumerate(["First answer about APIs", "Second answer about caching"]):
        ok = client.post(
            "/api/interview/answer",
            headers=_auth("tok-cand"),
            json={"sessionId": sid, "questionIndex": i, "question": questions[i], "answer": text},
        )
        assert ok.status_code == 200
    # Reload: the waiting room starts again (free interview already used) -> same session, not a 402, no re-roll.
    back = _start(client)
    assert back.status_code == 200, back.text
    body = back.json()
    assert body["sessionId"] == sid and body["resumed"] is True
    assert body["questions"] == questions  # no re-rolled questions
    assert body["questionIndex"] == 2 and body["answers"] == ["First answer about APIs", "Second answer about caching"]
    assert body["question"] == questions[2]
    assert len(batch_calls) == 1


def test_recorded_answers_win_at_scoring(env, batch_calls):
    from app.services.interview_integrity import authoritative_answers

    client, db, pool = env
    started = _start(client).json()
    sid = started["sessionId"]
    client.post("/api/interview/answer", headers=_auth("tok-cand"),
                json={"sessionId": sid, "questionIndex": 0, "question": started["questions"][0], "answer": "kept"})
    session = db["interviewSessions"][sid]
    assert authoritative_answers(session, ["changed later"], started["questions"][:1]) == ["kept"]


def test_interview_left_for_hours_is_abandoned_and_the_candidate_is_told(env, batch_calls):
    client, db, pool = env
    started = _start(client).json()
    sid = started["sessionId"]
    client.post("/api/interview/enter", headers=_auth("tok-cand"), json={"sessionId": sid})
    db["interviewSessions"][sid]["startedAt"] = _iso(datetime.now(timezone.utc) - timedelta(hours=7))
    pool.state["free"].clear()  # let a new career interview be prepared in this fake
    res = _start(client)
    assert res.status_code == 200, res.text
    assert res.json()["sessionId"] != sid
    assert db["interviewSessions"][sid]["status"] == "abandoned"
    assert res.json()["previousAttempt"]["status"] == "abandoned"
    assert "ended" in res.json()["previousAttempt"]["message"]
    # The ended session cannot be continued.
    nxt = client.post("/api/interview/next", headers=_auth("tok-cand"), json={"sessionId": sid})
    assert nxt.status_code == 410 and nxt.json()["code"] == "SESSION_ABANDONED"


def test_unused_prepared_session_expires(env, batch_calls):
    client, db, pool = env
    sid = _start(client).json()["sessionId"]
    db["interviewSessions"][sid]["createdAt"] = _iso(datetime.now(timezone.utc) - timedelta(minutes=ivlife.PENDING_TTL_MINUTES + 1))
    fresh = _start(client).json()["sessionId"]
    assert fresh != sid and db["interviewSessions"][sid]["status"] == "expired"
    res = client.post("/api/interview/enter", headers=_auth("tok-cand"), json={"sessionId": sid})
    assert res.status_code == 410
    assert pool.state["free"] == set()


def test_booked_slot_locks_the_career_interview_in_every_tab(env, batch_calls, monkeypatch):
    client, db, pool = env
    opens = datetime.now(timezone.utc) + timedelta(hours=2)

    async def booking(_db, _email, _user):
        return {"token": "t1", "jobId": None, "status": "too_early", "scheduledStart": _iso(opens),
                "scheduledEnd": _iso(opens + timedelta(minutes=15)), "jobTitle": "AI Interview"}

    monkeypatch.setattr(api_dispatch, "_candidate_booking", booking)
    res = _start(client)
    assert res.status_code == 409
    assert res.json()["code"] == "INTERVIEW_BOOKED" and res.json()["booking"]["scheduledStart"] == _iso(opens)
    assert batch_calls == [] and db["interviewSessions"] == {}
    got = client.get("/api/interview/booking", headers=_auth("tok-cand"))
    assert got.status_code == 200 and got.json()["booking"]["token"] == "t1"


def test_context_key_prefers_the_application_over_the_invite_token():
    a = ivlife.interview_context_key(email="x@y.z", invite_token="tok", application_id="app1", job_id="j",
                                     role="", level="", job_description="")
    b = ivlife.interview_context_key(email="x@y.z", invite_token=None, application_id="app1", job_id=None,
                                     role="Dev", level="", job_description="")
    assert a == b


def test_resume_state_points_at_the_first_unanswered_question():
    session = {"questions": [{"text": f"q{i}"} for i in range(4)], "totalTurns": 4,
               "history": [{"question": {"text": "q0"}, "answer": "a0"}]}
    state = ivlife.resume_state(session)
    assert state["questionIndex"] == 1 and state["answers"] == ["a0"]
    session["history"] = [{"question": {"text": f"q{i}"}, "answer": "a"} for i in range(4)]
    assert ivlife.resume_state(session)["questionIndex"] == 3  # never past the last question


def test_llm_flag_false_when_all_fallback(env, monkeypatch):
    async def fake_batch(_payload):
        return {"questions": [{"text": f"Fallback {i}?", "fallback": True} for i in range(1, 4)], "totalTurns": 3}

    monkeypatch.setattr(api_dispatch.ia, "generate_adaptive_question_batch", fake_batch)
    res = _start(env[0])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["llm"] is False
    assert body["fallbackCount"] == 3


def test_llm_flag_true_when_one_question_is_not_a_fallback(env, monkeypatch):
    async def fake_batch(_payload):
        return {
            "questions": [
                {"text": "What did you ship in your last role?", "fallback": False},
                {"text": "Fallback question?", "fallback": True},
            ],
            "totalTurns": 2,
        }

    monkeypatch.setattr(api_dispatch.ia, "generate_adaptive_question_batch", fake_batch)
    res = _start(env[0])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["llm"] is True
    assert body["fallbackCount"] == 1
