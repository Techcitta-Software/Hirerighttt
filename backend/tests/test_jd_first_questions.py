"""Job-link interviews: JD-first question mix (~80% JD, ~20% resume-to-JD alignment, >=1 behavioural, 20 minutes)."""

from __future__ import annotations

import asyncio
import json

import pytest

from app.services import interview_jd_plan as jp
from app.services import interview_llm_questions as qmod

JD = """Backend Engineer - Payments

Responsibilities:
- Design and maintain REST APIs for the payments ledger in Python and FastAPI.
- Own PostgreSQL schema changes and query performance for high-volume tables.
- Build event pipelines on Kafka for settlement and reconciliation.
- Collaborate with product and finance teams to ship features safely.

Requirements:
- 3+ years with Python, FastAPI, PostgreSQL, Kafka, Docker.
"""

CTX = {
    "skills": ["Python", "Django", "PostgreSQL", "Redis"],
    "jobs": ["Software Engineer at Acme Fintech (2021-2024)"],
    "resumeSnippet": "Software Engineer at Acme Fintech. Built Django REST services for card payouts on PostgreSQL.",
}


def test_mix_is_80_20_with_a_behavioural_question() -> None:
    mix = jp.jd_question_mix(9)
    assert mix == {"jd": 6, "jd-alignment": 2, "behavioural": 1}
    assert jp.jd_question_mix(5)["behavioural"] >= 1
    assert jp.jd_question_mix(5)["jd-alignment"] >= 1


def test_plan_slots_follow_the_mix_and_target_the_jd() -> None:
    plan = jp.build_jd_first_plan(
        job_description=JD, jd_skills=["Python", "FastAPI", "PostgreSQL", "Kafka", "Docker"], level="3-5 years"
    )
    assert len(plan) == jp.JD_INTERVIEW_SCORED_QUESTIONS
    slots = [p["slot"] for p in plan]
    assert slots.count("jd") == 6 and slots.count("jd-alignment") == 2 and slots.count("behavioural") == 1
    assert slots[0] == "jd-alignment"  # the opener ties recent work to the job
    jd_targets = [p["target"] for p in plan if p["slot"] == "jd"]
    assert "Python" in jd_targets and "FastAPI" in jd_targets
    # Responsibilities from the JD are question targets too, not only skill names.
    assert any("REST APIs" in t or "PostgreSQL schema" in t for t in jd_targets)
    assert all("Mid level" in p["purpose"] for p in plan if p["slot"] == "jd")


def test_responsibilities_are_extracted_from_the_jd() -> None:
    duties = jp.extract_jd_responsibilities(JD)
    assert duties[0].startswith("Design and maintain REST APIs")
    assert not any(d.startswith("3+ years") for d in duties)


def test_seniority_tier() -> None:
    assert jp.seniority_tier("Fresher", fresher=True) == "entry"
    assert jp.seniority_tier("1-2 years") == "entry"
    assert jp.seniority_tier("3 – 5 Years") == "mid"
    assert jp.seniority_tier("Senior Engineer") == "senior"
    assert jp.seniority_tier("8+ years") == "senior"


def test_slot_validation_rejects_off_plan_questions() -> None:
    plan = jp.build_jd_first_plan(job_description=JD, jd_skills=["Kafka"], level="3 years")
    beh = next(p for p in plan if p["slot"] == "behavioural")
    align = next(p for p in plan if p["slot"] == "jd-alignment")
    kafka = next(p for p in plan if p["slot"] == "jd" and p["target"] == "Kafka")
    assert jp.validate_slot_question({"text": "Tell me about a time a release you owned slipped. What did you do?"}, beh, [])
    assert not jp.validate_slot_question({"text": "How does Kafka guarantee ordering within a partition?"}, beh, [])
    assert jp.validate_slot_question({"text": "How would you use Kafka consumer groups to process settlement events safely?"}, kafka, [])
    assert not jp.validate_slot_question({"text": "What is the difference between a list and a tuple in Python?"}, kafka, [])
    assert jp.validate_slot_question(
        {"text": "At Acme Fintech you built Django payout services. How does that prepare you for this ledger work?"}, align, []
    )
    # Duplicates of an earlier question are rejected.
    q = "How would you use Kafka consumer groups to process settlement events safely?"
    assert not jp.validate_slot_question({"text": q}, kafka, [q])


def test_is_jd_first_only_for_job_links_with_a_jd() -> None:
    assert jp.is_jd_first_interview(question_mode="vendor_jd", job_description=JD)
    assert jp.is_jd_first_interview(question_mode="employer", job_description=JD)
    assert jp.is_jd_first_interview(question_mode="individual_jd", job_description=JD, invite_token="tok")
    assert not jp.is_jd_first_interview(question_mode="individual_jd", job_description=JD)
    assert not jp.is_jd_first_interview(question_mode="resume_only", job_description="")
    assert not jp.is_jd_first_interview(question_mode="vendor_jd", job_description="short")


VARIETY = [
    "considering latency budgets",
    "when reconciliation jobs fail overnight",
    "while onboarding new merchants quickly",
    "under strict audit requirements",
    "with traffic spikes during sales",
    "given flaky downstream banks",
    "for multi-region failover",
    "while keeping costs predictable",
    "with junior teammates reviewing code",
    "during a schema migration freeze",
]


def _fake_model(answers: dict[str, str]):
    """Return a fake _gemini_generate that writes one question per requested turn based on its slot."""
    calls: list[dict] = []

    async def fake(system: str, user: str, *, temperature: float, max_tokens: int = 2048) -> str:
        payload = json.loads(user)
        calls.append(payload)
        out = []
        for t in payload["turns"]:
            angle = VARIETY[t["turnNumber"] % len(VARIETY)]
            text = answers.get(t["slot"], "").format(target=t["target"], n=angle)
            out.append({"turnNumber": t["turnNumber"], "question": {"text": text, "category": "Technical"}})
        return json.dumps({"questions": out})

    return fake, calls


def _run_batch(monkeypatch: pytest.MonkeyPatch, fake) -> dict:
    monkeypatch.setattr(qmod, "_gemini_generate", fake)
    monkeypatch.setattr("app.services.interview_api.llm_configured", lambda: True)
    return asyncio.run(
        qmod.generate_adaptive_question_batch_llm(
            {
                "profile": {"resumeText": CTX["resumeSnippet"]},
                "ctx": CTX,
                "role": "Backend Engineer",
                "level": "3 – 5 Years",
                "fresher": False,
                "jobDescription": JD,
                "skillFocus": ["Python", "PostgreSQL"],
                "jdSkills": ["Python", "FastAPI", "PostgreSQL", "Kafka", "Docker"],
                "jdFirst": True,
            }
        )
    )


def test_batch_enforces_the_jd_mix(monkeypatch: pytest.MonkeyPatch) -> None:
    fake, calls = _fake_model(
        {
            "jd": "In this role, how would you apply {target} to the payments ledger work, {n}?",
            "jd-alignment": "In your previous role at Acme Fintech, what work maps to {target}, {n}?",
            "behavioural": "Tell me about a time you were under deadline pressure doing work like {target}, {n}.",
        }
    )
    out = _run_batch(monkeypatch, fake)
    assert out["jdFirst"] is True and out["durationMinutes"] == 20
    assert out["totalTurns"] == jp.JD_INTERVIEW_TURN_COUNT == len(out["questions"])
    assert out["fallbackTurn"] is None and out["closingTurn"] is None
    scored = out["questions"][:-1]
    assert out["questions"][-1]["focus"] == "structured-closing"
    assert jp.questions_fit_jd_mix(scored)
    assert out["questionMix"] == {"jd": 6, "jd-alignment": 2, "behavioural": 1}
    assert all(q.get("planSlot") for q in scored)
    assert next(q for q in scored if q["planSlot"] == "behavioural")["scoringProfile"] == "behavioral"
    assert len(calls) == 1
    sent = calls[0]
    assert sent["jobDescription"].startswith("Backend Engineer")
    assert {t["slot"] for t in sent["turns"]} == {"jd", "jd-alignment", "behavioural"}


def test_off_plan_output_is_regenerated_then_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    # The model never writes a behavioural question (it keeps asking a technical one in that slot).
    fake, calls = _fake_model(
        {
            "jd": "In this role, how would you apply {target} to the payments ledger work, {n}?",
            "jd-alignment": "In your previous role at Acme Fintech, what work maps to {target}, {n}?",
            "behavioural": "Explain how database indexes speed up lookups on large tables, {n}?",
        }
    )
    out = _run_batch(monkeypatch, fake)
    # Only the rejected slot was asked for again.
    assert len(calls) == 3
    assert [t["slot"] for t in calls[1]["turns"]] == ["behavioural"]
    assert "alreadyAsked" in calls[1]
    beh = next(q for q in out["questions"] if q.get("planSlot") == "behavioural")
    assert beh.get("fallback") is True and beh["text"].startswith("Tell me about a time")
    assert jp.questions_fit_jd_mix(out["questions"][:-1])


def test_non_job_interviews_keep_the_resume_plan(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake(system: str, user: str, *, temperature: float, max_tokens: int = 2048) -> str:
        payload = json.loads(user)
        assert "slot" not in payload["turns"][0]
        return json.dumps(
            {"questions": [{"turnNumber": t["turnNumber"], "question": {"text": f"Resume question number {t['turnNumber']} on the topic?"}} for t in payload["turns"]]}
        )

    monkeypatch.setattr(qmod, "_gemini_generate", fake)
    monkeypatch.setattr("app.services.interview_api.llm_configured", lambda: True)
    out = asyncio.run(
        qmod.generate_adaptive_question_batch_llm(
            {"profile": {"resumeText": "x"}, "ctx": CTX, "role": "Backend Engineer", "level": "3 – 5 Years", "fresher": False,
             "jobDescription": JD, "jdFirst": False}
        )
    )
    assert out["totalTurns"] == qmod.EXPERIENCED_INTERVIEW_TURN_COUNT
    assert "jdFirst" not in out


# ------------------------------------------------------------------ /api/interview/start picks the JD-first plan
from tests.test_security_fixes import CONSENT, _auth, env  # noqa: E402,F401  (env is a pytest fixture)


def _capture_batch(monkeypatch: pytest.MonkeyPatch) -> list[dict]:
    from app.dispatch import api_dispatch

    seen: list[dict] = []

    async def fake_batch(payload):
        seen.append(payload)
        qs = [{"text": f"Question {i} about the job requirements in detail?", "category": "Technical", "keywords": []} for i in range(1, 11)]
        out = {"questions": qs, "totalTurns": 10 if payload.get("jdFirst") else 6}
        if payload.get("jdFirst"):
            out.update({"jdFirst": True, "durationMinutes": 20})
        return out

    monkeypatch.setattr(api_dispatch.ia, "generate_adaptive_question_batch", fake_batch)
    return seen


def test_job_link_start_uses_the_jd_first_plan(env, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: F811
    client, db, _pool = env
    seen = _capture_batch(monkeypatch)
    db["employerApplications"].append({"id": "app-1", "organizationId": "org1", "jobId": "job-open",
                                       "candidateEmail": "cand@example.com", "data": {}})
    res = client.post("/api/interview/start", headers=_auth("tok-cand"), json={"consent": CONSENT, "jobId": "job-open"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert seen[-1]["jdFirst"] is True and seen[-1]["jobDescription"].startswith("Python APIs")
    assert body["jdFirst"] is True and body["durationMinutes"] == 20 and body["total"] == 10
    session = db["interviewSessions"][body["sessionId"]]
    assert session["jdFirst"] is True and session["applicationId"] == "app-1"


def test_career_interview_keeps_the_resume_plan(env, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: F811
    client, db, _pool = env
    seen = _capture_batch(monkeypatch)
    res = client.post("/api/interview/start", headers=_auth("tok-cand"), json={"consent": CONSENT, "role": "Dev"})
    assert res.status_code == 200, res.text
    assert seen[-1]["jdFirst"] is False
    assert res.json()["jdFirst"] is False and res.json()["durationMinutes"] is None
