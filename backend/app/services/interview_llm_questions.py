"""Gemini-only adaptive interview question generation (no static bank)."""

from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx


class InterviewLlmQuestionError(Exception):
    def __init__(self, code: str, message: str, status: int = 503) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


PENDING_FALLBACK_FOCUS = "pending-fallback"
PENDING_CLOSING_FOCUS = "pending-closing"
MAX_ROLE_SKILLS = 3
EXPERIENCE_PROJECT_TURNS = 2
EXPERIENCED_INTERVIEW_TURN_COUNT = (
    1 + MAX_ROLE_SKILLS + EXPERIENCE_PROJECT_TURNS + 1 + 1
)


def _experienced_fallback_turn_number() -> int:
    return 1 + MAX_ROLE_SKILLS + EXPERIENCE_PROJECT_TURNS + 1


def _experienced_closing_turn_number() -> int:
    return EXPERIENCED_INTERVIEW_TURN_COUNT


def _gemini_key() -> str:
    return (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or "").strip()


def _quality_model() -> str:
    return os.environ.get("PRIMARY_MODEL") or os.environ.get("FAST_MODEL") or "gemini-2.0-flash"


def _system_prompt(*, turn: int, total: int, role: str, level: str) -> str:
    return f"""You are Ava, a professional interviewer. Generate exactly ONE interview question as JSON only.
Turn {turn} of {total}. Role: {role}. Experience: {level}.
Rules:
- Sound natural, one clear idea, short sentences.
- Theory/skill turns: conceptual only (define, compare, how it works). NO scenarios, NO "tell me about a time", NO hypotheticals, NO live coding.
- Experience/project turns: may reference resume context when provided.
- Never invent employers or projects not in the payload.
Return ONLY: {{"question":{{"text":"...","category":"Technical|Experience|Problem Solving|Communication","keywords":["..."],"hint":"...","topic":"..."}}}}"""


def _batch_system_prompt(*, total: int, role: str, level: str, fresher: bool) -> str:
    skip = ""
    if not fresher:
        fb = _experienced_fallback_turn_number()
        cl = _experienced_closing_turn_number()
        skip = (
            f"Do NOT generate turn {fb} (fallback follow-up) or turn {cl} (closing thanks) — "
            "those are generated later, in order, after prior answers."
        )
    return f"""You are Ava, a professional interviewer. Generate ALL interview questions for this session in ONE JSON response.
Total turns in session: {total}. Role: {role}. Experience: {level}.
Rules:
- Generate exactly one question per turnNumber in the user payload "turns" list.
- {skip}
- Each question must be distinct. Theory turns: conceptual only. Project turns: use resume context only.
Return ONLY: {{"questions":[{{"turnNumber":1,"question":{{"text":"...","category":"...","keywords":["..."],"hint":"...","topic":"..."}}}}, ...]}}"""


def _parse_question(raw: str, prior: list[str] | None = None) -> dict[str, Any] | None:
    prior = prior or []
    match = re.search(r"\{[\s\S]*\}", raw or "")
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    q = data.get("question") if isinstance(data.get("question"), dict) else data
    if not isinstance(q, dict):
        return None
    text = str(q.get("text") or "").strip()
    if len(text) < 24:
        return None
    if text in prior:
        return None
    return {
        "text": text,
        "category": q.get("category") or "Technical",
        "keywords": q.get("keywords") if isinstance(q.get("keywords"), list) else [],
        "hint": q.get("hint") or "Answer clearly and stay on topic.",
        "topic": q.get("topic") or q.get("category") or "Interview",
        "focus": "adaptive-llm",
    }


def _pending_fallback_question() -> dict[str, Any]:
    return {
        "text": "",
        "category": "Problem Solving",
        "keywords": ["follow-up"],
        "hint": "Answer with a concrete example from your recent role.",
        "topic": "Recent work follow-up",
        "focus": PENDING_FALLBACK_FOCUS,
    }


def _pending_closing_question() -> dict[str, Any]:
    return {
        "text": "",
        "category": "Communication",
        "keywords": ["closing", "thanks"],
        "hint": "A brief, professional sign-off is fine.",
        "topic": "Closing",
        "focus": PENDING_CLOSING_FOCUS,
    }


async def _gemini_generate(system: str, user: str, *, temperature: float, max_tokens: int = 2048) -> str:
    key = _gemini_key()
    model = _quality_model()
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens},
    }
    async with httpx.AsyncClient(timeout=90.0) as client:
        res = await client.post(url, headers={"Content-Type": "application/json", "x-goog-api-key": key}, json=body)
        if not res.is_success:
            return ""
        data = res.json()
        parts = ((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
        return "".join(p.get("text") or "" for p in parts if not p.get("thought"))


async def generate_adaptive_question_llm(input: dict) -> dict:
    from app.services.interview_api import llm_configured, summarize_profile

    if not llm_configured():
        raise InterviewLlmQuestionError(
            "LLM_QUESTION_REQUIRED",
            "Interview questions require GEMINI_API_KEY on the server.",
        )
    history = input.get("history") or []
    total = int(input.get("totalTurns") or 7)
    if len(history) >= total:
        raise InterviewLlmQuestionError("INTERVIEW_COMPLETE", "All interview turns are complete.", 400)
    turn = len(history) + 1
    role = str(input.get("role") or "Full Stack Engineer")
    level = str(input.get("level") or "1–3 years")
    ctx = input.get("ctx") or summarize_profile(input.get("profile"), input.get("accountName") or "Candidate")
    prior = [str((h.get("question") or {}).get("text") or h.get("question") or "") for h in history]
    user = json.dumps(
        {
            "turnNumber": turn,
            "totalTurns": total,
            "role": role,
            "experienceLevel": level,
            "varietySeed": input.get("varietySeed"),
            "jobDescription": (input.get("jobDescription") or "")[:4000] or None,
            "candidateSummary": {
                "skills": (ctx.get("skills") or [])[:16],
                "jobs": (ctx.get("jobs") or [])[:4],
                "resumeSnippet": (ctx.get("resumeSnippet") or "")[:2800],
            },
            "priorQuestions": prior,
            "lastAnswer": (input.get("lastAnswer") or "").strip() or None,
        }
    )
    system = _system_prompt(turn=turn, total=total, role=role, level=level)
    for temperature in (0.55, 0.35, 0.22):
        raw = await _gemini_generate(system, user, temperature=temperature)
        q = _parse_question(raw, prior)
        if q:
            return q
    raise InterviewLlmQuestionError(
        "LLM_QUESTION_FAILED",
        "Gemini could not produce a valid interview question. Please try again.",
    )


async def generate_adaptive_question_batch_llm(input: dict) -> dict[str, Any]:
    from app.services.interview_api import _is_fresher, llm_configured, summarize_profile

    if not llm_configured():
        raise InterviewLlmQuestionError(
            "LLM_QUESTION_REQUIRED",
            "Interview questions require GEMINI_API_KEY on the server.",
        )
    profile = input.get("profile")
    level = str(input.get("level") or "1–3 years")
    ctx = input.get("ctx") or summarize_profile(profile, input.get("accountName") or "Candidate")
    fresher = bool(input.get("fresher")) if "fresher" in input else _is_fresher(profile, level, ctx)
    total = int(input.get("totalTurns") or (7 if fresher else EXPERIENCED_INTERVIEW_TURN_COUNT))
    role = str(input.get("role") or "Full Stack Engineer")
    fallback_turn = None if fresher else _experienced_fallback_turn_number()
    closing_turn = None if fresher else _experienced_closing_turn_number()
    turn_numbers = [
        t
        for t in range(1, total + 1)
        if fresher or (t != fallback_turn and t != closing_turn)
    ]
    user = json.dumps(
        {
            "totalTurns": total,
            "role": role,
            "experienceLevel": level,
            "varietySeed": input.get("varietySeed"),
            "jobDescription": (input.get("jobDescription") or "")[:4000] or None,
            "turns": [{"turnNumber": t} for t in turn_numbers],
            "candidateSummary": {
                "skills": (ctx.get("skills") or [])[:16],
                "jobs": (ctx.get("jobs") or [])[:4],
                "resumeSnippet": (ctx.get("resumeSnippet") or "")[:2800],
            },
        }
    )
    system = _batch_system_prompt(total=total, role=role, level=level, fresher=fresher)
    ordered: list[dict[str, Any] | None] = [None] * total

    def apply_batch(raw: str) -> bool:
        match = re.search(r"\{[\s\S]*\}", raw or "")
        if not match:
            return False
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            return False
        items = data.get("questions") if isinstance(data.get("questions"), list) else []
        prior: list[str] = []
        for turn in range(1, total + 1):
            if fallback_turn and turn == fallback_turn:
                ordered[turn - 1] = _pending_fallback_question()
                continue
            if closing_turn and turn == closing_turn:
                ordered[turn - 1] = _pending_closing_question()
                continue
            item = next((x for x in items if int(x.get("turnNumber") or 0) == turn), None)
            if not item or not isinstance(item.get("question"), dict):
                continue
            q = _parse_question(json.dumps({"question": item["question"]}), prior)
            if q:
                ordered[turn - 1] = q
                prior.append(q["text"])
        def slot_ok(i: int) -> bool:
            q = ordered[i]
            if q is None:
                return False
            focus = q.get("focus")
            if focus in (PENDING_FALLBACK_FOCUS, PENDING_CLOSING_FOCUS):
                return True
            return len(str(q.get("text") or "")) >= 24

        return all(slot_ok(i) for i in range(total))

    for temperature in (0.55, 0.42, 0.35, 0.28):
        raw = await _gemini_generate(system, user, temperature=temperature, max_tokens=8192)
        if apply_batch(raw):
            return {
                "questions": ordered,
                "fallbackTurn": fallback_turn,
                "closingTurn": closing_turn,
                "totalTurns": total,
            }
    raise InterviewLlmQuestionError(
        "LLM_QUESTION_FAILED",
        "Gemini could not produce a valid interview question batch. Please try again.",
    )
