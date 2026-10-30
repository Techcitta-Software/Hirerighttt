from __future__ import annotations

import os
from typing import Any

from app.services.interview_agent import (
    build_questions,
    resolve_candidate_name,
    score_session,
    summarize_profile,
)
from app.services.vendor.ats_score import compute_ats_score, extract_primary_skills_from_jd

INTERVIEW_TURN_COUNT = 6


def llm_configured() -> bool:
    return bool(
        os.environ.get("GEMINI_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
        or os.environ.get("OPENROUTER_API_KEY")
        or os.environ.get("LLM_API_KEY")
    )


def resolve_interview_question_mode(options: dict | None = None) -> str:
    options = options or {}
    mode = options.get("mode")
    if mode == "vendor_jd":
        return "vendor_jd"
    if mode == "resume_only":
        return "resume_only"
    if mode in ("employer",) or options.get("applicationId") or options.get("jobId"):
        return "employer"
    if mode == "individual_jd":
        return "individual_jd"
    return "resume_only"


def analyze_interview_skill_match(
    *, job_description: str, required_skills: list, profile: dict, ctx: dict
) -> dict:
    resume_text = str(profile.get("resumeText") or ctx.get("resumeSnippet") or "")
    jd_skills = extract_primary_skills_from_jd(job_description, required_skills or [])
    legacy = compute_ats_score({"jobDescription": job_description, "resumeText": resume_text, "requiredSkills": jd_skills})
    return {
        "jdSkills": jd_skills,
        "matchedSkills": legacy.get("matchedSkills") or [],
        "missingSkills": legacy.get("missingSkills") or [],
        "atsScore": legacy.get("atsScore"),
        "jdMatchScore": legacy.get("jdMatchScore"),
        "resumeSkillCoverage": legacy.get("resumeSkillCoverage"),
        "atsBreakdown": None,
    }


def generate_adaptive_question_local(input: dict) -> dict:
    ctx = input.get("ctx") or summarize_profile(input.get("profile"), input.get("accountName") or "Candidate")
    role = input.get("role") or "Full Stack Engineer"
    level = input.get("level") or "1–3 years"
    history = input.get("history") or []
    bank = build_questions(role, level, input.get("profile"), name=ctx.get("name") or "there")
    idx = min(len(history), len(bank) - 1)
    q = bank[idx]
    return {**q, "focus": "adaptive-local"}


async def generate_adaptive_question(input: dict) -> dict:
    return generate_adaptive_question_local(input)


async def generate_vendor_job_question(input: dict, _options: dict | None = None) -> dict:
    ctx = input.get("ctx") or {}
    role = input.get("role") or "Engineer"
    jd = str(input.get("jobDescription") or "")
    skill = (input.get("requiredSkills") or extract_primary_skills_from_jd(jd, []))[:1]
    topic = skill[0] if skill else role
    return {
        "text": f"Describe a concrete example where you applied {topic} in a {role} context.",
        "category": "Technical",
        "keywords": [str(topic).lower(), "example", "outcome"],
        "hint": "Situation, action, result.",
        "focus": "vendor-jd-local",
    }


async def generate_interview_turn(input: dict) -> dict:
    answer = str(input.get("answer") or "").strip()
    qtext = str((input.get("question") or {}).get("text") or "")
    ack = "Thanks for sharing." if answer else "Take your time when you're ready."
    return {
        "acknowledgment": ack,
        "transition": "Let's continue.",
        "questionIndex": int(input.get("questionIndex") or 0),
        "lastQuestion": qtext[:200],
    }


def get_interview_interactive_flow_json() -> dict:
    return {
        "phases": ["day_check", "confirm_role", "questions"],
        "commands": ["next", "repeat", "slower", "pause"],
    }


def process_interview_interactive(input: dict) -> dict:
    phase = str(input.get("phase") or "day_check")
    user_text = str(input.get("userText") or "").strip()
    role = str(input.get("role") or "Full Stack Engineer")
    if phase == "day_check":
        return {"phase": "confirm_role", "prompt": f"Ready to begin your {role} interview?", "heard": user_text}
    if phase == "confirm_role":
        return {"phase": "questions", "prompt": "Great — first question coming up.", "heard": user_text}
    return {"phase": phase, "prompt": "Continue when ready.", "heard": user_text}


async def score_interview_session(input: dict) -> dict:
    return score_session(
        role=input.get("role") or "Full Stack Engineer",
        level=input.get("level") or "1–3 years",
        questions=input.get("questions") or [],
        answers=input.get("answers") or [],
        profile=input.get("profile"),
        integrity=input.get("integrity"),
        name=input.get("accountName") or "Candidate",
    )


async def parse_resume_with_ai(text: str) -> dict | None:
    if len(str(text or "").strip()) < 40:
        return None
    ctx = summarize_profile({"resumeText": text}, "Candidate")
    return {
        "fullName": resolve_candidate_name({"resumeText": text}, ""),
        "skills": ctx.get("skills") or [],
        "resumeText": text[:50000],
    }


def build_jd_coverage_plan(**kwargs) -> dict:
    jd = str(kwargs.get("jobDescription") or "")
    skills = kwargs.get("requiredSkills") or extract_primary_skills_from_jd(jd, [])
    return {"skills": skills, "topics": skills[:6]}


def structured_plan_summary(*_a, **_k) -> dict:
    return {"totalTurns": INTERVIEW_TURN_COUNT, "fresher": False, "recommendedSkills": []}


def resolve_exact_interview_role(profile: dict | None, role: str) -> str:
    profile = profile or {}
    return str(profile.get("currentRole") or role or "Software professional")


async def init_role_skill_store() -> None:
    return None


async def ensure_role_skills_for_role(_role: str, **_k) -> list:
    return []


def analyze_opening_answer_alignment(*_a, **_k) -> dict:
    return {"aligned": True}


async def call_llm_api(**_k) -> str | None:
    return None
