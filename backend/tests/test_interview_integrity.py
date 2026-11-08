"""Interview integrity: no re-scoring, server-recorded answers win, one attempt per invite, job scores stick."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.services.interview_integrity import authoritative_answers, invite_attempt_used, session_is_stale
from app.services.vendor.jobs import attach_candidate_report_to_application, update_application_interview

Q = [{"text": "Tell me about yourself and your current role?"}, {"text": "What is the Python GIL and why does it matter?"}, {"text": "Thanks for your time today, that is all from me."}]


def test_server_recorded_answers_win_over_client_answers() -> None:
    session = {"history": [{"question": Q[0], "answer": "server answer one"}, {"question": Q[1], "answer": "server answer two"}]}
    client = ["rewritten one", "rewritten two", "final answer"]
    assert authoritative_answers(session, client, Q) == ["server answer one", "server answer two", "final answer"]


def test_client_answers_used_when_server_has_none() -> None:
    assert authoritative_answers({}, ["a", "b"], Q) == ["a", "b"]


def test_stops_at_first_question_without_any_answer() -> None:
    session = {"history": [{"question": Q[0], "answer": "one"}]}
    assert authoritative_answers(session, [], Q) == ["one"]


def test_stale_sessions() -> None:
    now = datetime.now(timezone.utc)
    fresh = {"startedAt": (now - timedelta(minutes=30)).isoformat()}
    old = {"startedAt": (now - timedelta(hours=7)).isoformat()}
    assert session_is_stale(fresh, now) is False
    assert session_is_stale(old, now) is True
    assert session_is_stale({}, now) is False


def test_one_completed_attempt_per_invite() -> None:
    db = {"interviewSessions": {"s1": {"inviteToken": "tok", "status": "active"}}}
    assert invite_attempt_used(db, "tok") is False
    db["interviewSessions"]["s1"]["status"] = "completed"
    assert invite_attempt_used(db, "tok") is True
    assert invite_attempt_used(db, "other") is False
    assert invite_attempt_used(db, "") is False


def test_job_interview_score_is_not_replaced_by_a_later_general_interview() -> None:
    app = {"id": "a1", "organizationId": "org", "candidateEmail": "c@example.com", "data": {"atsScore": 70}}
    db = {"employerApplications": [app], "interviews": {}, "profiles": {}}
    update_application_interview(db, "a1", "org", {"overall": 62}, {"interviewSessionId": "s1", "interviewSource": "job"})
    assert app["status"] == "interviewed" and app["data"]["interviewScore"] == 62
    # Later the candidate takes a practice interview for another role and scores 95.
    db["interviews"]["c@example.com"] = {"overall": 95}
    attach_candidate_report_to_application(db, app, "c@example.com", {"attachInterviewReport": True})
    assert app["data"]["interviewScore"] == 62
    assert app["data"]["interviewSource"] == "job"


def test_general_interview_is_attached_and_labelled_when_no_job_interview() -> None:
    app = {"id": "a2", "organizationId": "org", "candidateEmail": "c@example.com", "data": {"atsScore": 50}}
    db = {"interviews": {"c@example.com": {"overall": 80}}, "profiles": {}}
    attach_candidate_report_to_application(db, app, "c@example.com", {"attachInterviewReport": True})
    assert app["data"]["interviewScore"] == 80
    assert app["data"]["interviewSource"] == "general"
