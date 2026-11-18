"""Gemini-only adaptive interview question generation (no static bank)."""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any


class InterviewLlmQuestionError(Exception):
    def __init__(self, code: str, message: str, status: int = 503) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


# The browser gives up after ~45s, so key/model failover plus retries must finish (or fail cleanly) inside this.
REQUEST_DEADLINE_SECONDS = 36.0
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


from app.services.gemini_client import generate_content  # noqa: E402


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
- Generate exactly one question per turnNumber in the user payload "turns" list and follow that turn's "purpose" exactly.
- Ask ONE short question per turn (at most two sentences, under 45 words). Never combine two questions.
- category must be exactly one of: Technical, Experience, Problem Solving, Communication.
- {skip}
- Each question must be distinct. Theory turns: conceptual only. Project turns: use resume context only.
- If the payload has "alreadyAsked", those questions are already in the session: never repeat or rephrase them.
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


CLOSING_LINES = [
    "Thank you for your time today. It was helpful hearing about your experience. That is all from my side for this {role} interview. Wishing you the best with your next steps.",
    "I appreciate the detail you shared in this session. That brings us to the end of the {role} interview. Take care, and good luck.",
    "Thanks for walking me through your experience. We will wrap up here for this {role} conversation. Best wishes for what comes next.",
    "That is everything I had for today. Thank you for the thoughtful answers, and good luck with your {role} journey.",
]


def closing_statement(role: str, seed: str = "") -> dict[str, Any]:
    """Fixed thank-you for the last turn. It is a sign-off, not a question, and is never scored."""
    idx = sum(ord(c) for c in (seed or role)) % len(CLOSING_LINES)
    return {
        "text": CLOSING_LINES[idx].format(role=role or "this role"),
        "category": "Communication",
        "keywords": [],
        "hint": "No answer needed. You can say goodbye or end the interview.",
        "topic": "Closing",
        "focus": "structured-closing",
        "scoringProfile": "behavioral",
    }


def _resume_grounded_role_skills(role: str, profile: dict[str, Any], ctx: dict[str, Any]) -> list[str]:
    """The skills the three theory turns ask about: the role's standard skills that the candidate actually has,
    topped up with the candidate's own skills. (Using the role catalog alone asked a Java engineer about Node.js and
    a fresher about Git, neither of which was on their resume.)"""
    from app.services.interview_agent import _load_required_role_skills
    from app.services.role_skills_fit_scoring import skill_evidence_on_resume

    catalog = _load_required_role_skills(role, profile)
    chosen = [s for s in catalog if skill_evidence_on_resume(s, ctx)]
    for s in ctx.get("skills") or []:
        if len(chosen) >= MAX_ROLE_SKILLS:
            break
        name = str(s).strip()
        if name and all(name.lower() != c.lower() for c in chosen):
            chosen.append(name)
    return chosen[:MAX_ROLE_SKILLS] or catalog[:MAX_ROLE_SKILLS]


def _turn_plan(*, total: int, fresher: bool, role_skills: list[str], from_job: bool = False) -> dict[int, str]:
    """What each turn is for, so the model stops guessing (theory vs project vs opening)."""
    skills = (role_skills + ["your core stack"] * 3)[:3]
    plan: dict[int, str] = {}
    job_note = " This skill is required by the job description and appears in the candidate's resume." if from_job else ""
    if fresher:
        plan[1] = "Opening: ask the candidate to introduce themselves and their background. Ava has already greeted them, so do not say hello again."
        for i, s in enumerate(skills):
            plan[2 + i] = f"Conceptual beginner question on {s} (definition, comparison or how it works). No scenario, no story.{job_note}"
        plan[5] = "Ask what the candidate built in a real academic or personal project from the resume (do not assume employment)."
        plan[6] = "Technical follow-up on that same project: how it was built, tested or debugged."
        return plan
    plan[1] = "Opening: roles, responsibilities and exposure at the candidate's most recent employer from the resume."
    for i, s in enumerate(skills):
        plan[2 + i] = f"Conceptual question on {s} (define, compare, how it works, trade-offs). Pitch the difficulty to the experience level. No scenario, no story, no live coding.{job_note}"
    plan[5] = "A real project or achievement from the resume: how it was designed and implemented. Use only tools evidenced in the resume."
    plan[6] = "Technical follow-up on that same project: testing, debugging or design trade-offs."
    return plan


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


def _thinking_level() -> str | None:
    """How much the model may reason before writing a question. Questions need wording, not deep reasoning, so the
    lightest level is used by default; INTERVIEW_THINKING=low|medium|high raises it, INTERVIEW_THINKING=off removes
    the setting (the model's own default)."""
    value = (os.environ.get("INTERVIEW_THINKING") or "minimal").strip().lower()
    return None if value in ("", "off", "default", "none") else value


async def _gemini_generate(system: str, user: str, *, temperature: float, max_tokens: int = 2048) -> str:
    """Generate JSON with key rotation and model fallback. Returns "" only if every key and model failed.

    Latency: JSON output mode (no prose or code fences to retry on) and minimal thinking."""
    result = await generate_content(
        system=system,
        user=user,
        temperature=temperature,
        max_tokens=max_tokens,
        timeout=25.0,
        total_budget=30.0,
        json_mode=True,
        thinking=_thinking_level(),
    )
    return result.text if result else ""


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
    experienced_flow = total == EXPERIENCED_INTERVIEW_TURN_COUNT
    if experienced_flow and turn == _experienced_closing_turn_number():
        return closing_statement(role, str(input.get("varietySeed") or ""))
    is_fallback_turn = experienced_flow and turn == _experienced_fallback_turn_number()
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
    if is_fallback_turn:
        system += (
            "\nThis turn is the FOLLOW-UP on recent work: ask one short, specific follow-up about something the candidate "
            "said in lastAnswer or about their most recent role. Do not introduce a new unrelated technical topic."
        )
    deadline = time.time() + REQUEST_DEADLINE_SECONDS
    for temperature in (0.55, 0.35, 0.22):
        if time.time() > deadline:
            break
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
    from app.services.interview_agent import _load_required_role_skills

    # Vendor job interviews pass skillFocus (skills shared by the JD and the resume); everyone else gets the
    # role's standard skills. Every other turn (opening, projects, follow-up, closing) is identical.
    skill_focus = [str(s) for s in (input.get("skillFocus") or []) if str(s).strip()]
    role_skills = skill_focus or _resume_grounded_role_skills(role, profile or {}, ctx)
    plan = _turn_plan(total=total, fresher=fresher, role_skills=role_skills, from_job=bool(skill_focus))
    fresher_closing_turn = total if fresher else None
    turn_numbers = [
        t
        for t in range(1, total + 1)
        if t != fallback_turn and t != closing_turn and t != fresher_closing_turn
    ]
    user = json.dumps(
        {
            "totalTurns": total,
            "role": role,
            "experienceLevel": level,
            "varietySeed": input.get("varietySeed"),
            "jobDescription": (input.get("jobDescription") or "")[:4000] or None,
            "turns": [{"turnNumber": t, "purpose": plan.get(t, "Resume-grounded interview question.")} for t in turn_numbers],
            "candidateSummary": {
                "skills": (ctx.get("skills") or [])[:16],
                "jobs": (ctx.get("jobs") or [])[:4],
                "resumeSnippet": (ctx.get("resumeSnippet") or "")[:2800],
            },
        }
    )
    system = _batch_system_prompt(total=total, role=role, level=level, fresher=fresher)
    ordered: list[dict[str, Any] | None] = [None] * total
    # Slots filled without the model: the follow-up and closing are written later, the fresher closing is fixed text.
    for turn in range(1, total + 1):
        if fallback_turn and turn == fallback_turn:
            ordered[turn - 1] = _pending_fallback_question()
        elif closing_turn and turn == closing_turn:
            ordered[turn - 1] = _pending_closing_question()
        elif fresher_closing_turn and turn == fresher_closing_turn:
            ordered[turn - 1] = closing_statement(role, str(input.get("varietySeed") or ""))

    def missing_turns() -> list[int]:
        return [t_ for t_ in turn_numbers if ordered[t_ - 1] is None]

    def apply_batch(raw: str) -> None:
        """Keep every valid question from this response; only the slots still empty are filled."""
        match = re.search(r"\{[\s\S]*\}", raw or "")
        if not match:
            return
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            return
        items = data.get("questions") if isinstance(data.get("questions"), list) else []
        for turn in missing_turns():
            item = next(
                (x for x in items if isinstance(x, dict) and str(x.get("turnNumber") or "").isdigit() and int(x["turnNumber"]) == turn),
                None,
            )
            if not item or not isinstance(item.get("question"), dict):
                continue
            prior = [str(q.get("text") or "") for q in ordered if q and q.get("text")]
            q = _parse_question(json.dumps({"question": item["question"]}), prior)
            if q:
                ordered[turn - 1] = q

    # The first call asks for every turn. If some come back unusable, the next call asks ONLY for those turns
    # (a much shorter answer) instead of regenerating the whole set, which used to double the start-up time.
    base_payload = json.loads(user)
    deadline = time.time() + REQUEST_DEADLINE_SECONDS
    for temperature in (0.55, 0.42, 0.35, 0.28):
        if time.time() > deadline:
            break
        need = missing_turns()
        if not need:
            break
        payload = dict(base_payload)
        if len(need) < len(turn_numbers):
            payload["turns"] = [x for x in base_payload["turns"] if x["turnNumber"] in need]
            payload["alreadyAsked"] = [q["text"] for q in ordered if q and q.get("text")]
        raw = await _gemini_generate(system, json.dumps(payload), temperature=temperature, max_tokens=8192)
        apply_batch(raw)
    if not missing_turns():
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
