"""Vendor job interviews: skill questions come from skills shared by the JD and the resume."""

from __future__ import annotations

import asyncio
import json

import pytest

from app.services import interview_llm_questions as qmod
from app.services.interview_api import vendor_skill_focus


def test_matched_skills_come_first_in_jd_order() -> None:
    analysis = {"jdSkills": ["Python", "SQL", "Docker", "React"], "matchedSkills": ["React", "Python"]}
    assert vendor_skill_focus(analysis, []) == ["Python", "React", "SQL"]


def test_fills_from_jd_when_few_skills_match() -> None:
    analysis = {"jdSkills": ["Kafka", "Go", "Kubernetes"], "matchedSkills": []}
    assert vendor_skill_focus(analysis, []) == ["Kafka", "Go", "Kubernetes"]


def test_case_insensitive_and_no_duplicates() -> None:
    analysis = {"jdSkills": ["node.js", "SQL"], "matchedSkills": ["Node.js", "sql"]}
    assert vendor_skill_focus(analysis, []) == ["node.js", "SQL"]


def test_uses_required_skills_when_analysis_has_no_jd_skills() -> None:
    assert vendor_skill_focus({}, ["Excel", "Tableau"]) == ["Excel", "Tableau"]


def test_turn_plan_marks_job_skills_and_keeps_other_turns() -> None:
    plan = qmod._turn_plan(total=8, fresher=False, role_skills=["Python", "React", "SQL"], from_job=True)
    assert "Python" in plan[2] and "job description" in plan[2]
    assert "SQL" in plan[4]
    # Opening and project turns are the same as a normal candidate interview.
    normal = qmod._turn_plan(total=8, fresher=False, role_skills=["Python", "React", "SQL"])
    assert plan[1] == normal[1] and plan[5] == normal[5] and plan[6] == normal[6]


def test_batch_uses_skill_focus_for_skill_turns(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict = {}

    async def fake_generate(system: str, user: str, *, temperature: float, max_tokens: int = 2048) -> str:
        payload = json.loads(user)
        captured["turns"] = payload["turns"]
        questions = [
            {"turnNumber": t["turnNumber"], "question": {"text": f"Question number {t['turnNumber']} about the topic at hand?", "category": "Technical"}}
            for t in payload["turns"]
        ]
        return json.dumps({"questions": questions})

    monkeypatch.setattr(qmod, "_gemini_generate", fake_generate)
    monkeypatch.setattr("app.services.interview_api.llm_configured", lambda: True)
    out = asyncio.run(qmod.generate_adaptive_question_batch_llm(
        {
            "profile": {"resumeText": "x"},
            "ctx": {"skills": ["Java"], "jobs": [], "resumeSnippet": "x"},
            "role": "Backend Engineer",
            "level": "3 – 5 Years",
            "fresher": False,
            "skillFocus": ["Kafka", "PostgreSQL", "Go"],
        }
    ))
    purposes = {t["turnNumber"]: t["purpose"] for t in captured["turns"]}
    assert "Kafka" in purposes[2] and "PostgreSQL" in purposes[3] and "Go" in purposes[4]
    assert len(out["questions"]) == qmod.EXPERIENCED_INTERVIEW_TURN_COUNT
