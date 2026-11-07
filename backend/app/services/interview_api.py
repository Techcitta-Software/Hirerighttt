from __future__ import annotations

import os
import re
from typing import Any

from app.services.interview_agent import (
    _extract_projects,
    resolve_candidate_name,
    score_session,
    score_session_async,
    summarize_profile,
)
from app.services.interview_llm_eval import llm_eval_configured
from app.services.vendor.ats_score import compute_ats_score, extract_primary_skills_from_jd

FRESHER_INTERVIEW_TURN_COUNT = 7
EXPERIENCED_INTERVIEW_TURN_COUNT = 8
INTERVIEW_TURN_COUNT = EXPERIENCED_INTERVIEW_TURN_COUNT
FRESHER_GREETING = "Thanks for joining today — I am Ava, and I will guide you through this interview."
FRESHER_THANK_YOU = "Thank you for your time today. That is all from my side. Wishing you the best with your next steps."
_CODING_LANGUAGE_RE = (
    r"^(python|javascript|typescript|java|c\+\+|c#|go|golang|ruby|kotlin|swift|php|dart|rust|scala|r|node\.?js)$"
)
_SQL_SKILL_RE = r"^(sql|postgresql|postgres|mysql|sqlite|tsql|pl/?sql)$"


def llm_configured() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))


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


def _is_fresher(profile: dict | None, level: str, ctx: dict | None = None) -> bool:
    experience = str((profile or {}).get("totalExperience") or level or "")
    if re.search(r"fresher|student|no (?:work )?experience|^0(?:\s*(?:years?|months?))?$|less than 1", experience, re.I):
        return True
    jobs = (ctx or {}).get("jobs") or []
    work = (profile or {}).get("workExperiences") or []
    if jobs or any((item or {}).get("company") or (item or {}).get("jobTitle") for item in work):
        return False
    return True


def _clean_skill(value: str) -> str:
    return str(value or "").strip()


def _is_coding_language(skill: str) -> bool:
    return bool(re.match(_CODING_LANGUAGE_RE, _clean_skill(skill), re.I))


def _is_sql_skill(skill: str) -> bool:
    return bool(re.match(_SQL_SKILL_RE, re.sub(r"\s+", "", _clean_skill(skill)), re.I))


def _pick_fresher_language(skills: list) -> str:
    known = [_clean_skill(skill) for skill in skills if _clean_skill(skill)]
    return next((skill for skill in known if _is_coding_language(skill)), "a programming language you know")


def _pick_fresher_other_skill(skills: list, coding_language: str) -> str:
    skip = {re.sub(r"[^a-z0-9+#]", "", value.lower()) for value in (coding_language, "SQL", "PostgreSQL", "MySQL")}
    for skill in skills:
        value = _clean_skill(skill)
        key = re.sub(r"[^a-z0-9+#]", "", value.lower())
        if value and key not in skip and not _is_sql_skill(value) and not _is_coding_language(value):
            return value
    return "a skill you know"


def _short_project_label(text: str) -> str:
    t = str(text or "").strip()
    if not t:
        return ""
    if len(t) <= 72:
        return t
    return f"{t[:69].rstrip()}…"


def _project_kind(evidence: str) -> str:
    if re.search(r"pipeline|etl|spark|airflow|warehouse", evidence, re.I):
        return "pipeline"
    if re.search(r"api|endpoint|authentication|backend|rest", evidence, re.I):
        return "api"
    if re.search(r"react|frontend|front.end|interface|web page|html|css", evidence, re.I):
        return "ui"
    if re.search(r"model|machine learning|prediction|classifier|tensorflow|pytorch", evidence, re.I):
        return "ml"
    return "general"


def _fresher_project_question_text(slot: int, project_line: str, last_answer: str = "") -> str:
    label = _short_project_label(project_line)
    evidence = f"{project_line} {last_answer if slot == 2 else ''}".lower()
    kind = _project_kind(evidence)
    if slot == 1:
        if label:
            return (
                f"I see {label} on your background. "
                "What part did you build yourself, and which tools or languages did you use?"
            )
        return "Pick one college or personal project. What was your part, and what did you use to build it?"
    follow = {
        "ui": "when a button or form did not behave the way you expected, how did you track down the cause?",
        "api": "when a request failed or returned the wrong data, how did you debug it?",
        "pipeline": "when data looked wrong in your pipeline step, how did you find where it broke?",
        "ml": "how did you check that your model or script worked on data it had not seen in training?",
        "general": "when something in that project failed, how did you figure out what went wrong?",
    }[kind]
    if label:
        return f"Staying on {label} — {follow}"
    return f"On that same project, {follow}"


def _fresher_question(turn: int, first: str, skills: list, projects: list, last_answer: str = "") -> dict:
    name = first if first and first != "there" else ""
    language = _pick_fresher_language(skills)
    other = _pick_fresher_other_skill(skills, language)
    project_line = str(projects[0] if projects else "")
    if turn <= 1:
        lead = f"{FRESHER_GREETING} {name}," if name else FRESHER_GREETING
        return {
            "text": f"{lead} to start, tell me a bit about yourself — your studies, what you've picked up so far, and the kind of role you want.".replace("  ", " ").strip(),
            "category": "Communication",
            "keywords": ["about yourself", "education", "background", "introduction"],
            "hint": "About a minute: who you are, your studies, and one thing you want from this role.",
            "topic": "About yourself",
            "focus": "structured-fresher-intro",
        }
    if turn == 2:
        return {
            "text": f"{(name + ', ') if name else ''}in simple terms, explain one basic idea in {language} — keep it short.",
            "category": "Technical",
            "keywords": [language.lower(), "language"],
            "hint": "Explain the concept in simple words. No job story is required.",
            "topic": language,
            "focus": "structured-theory-2",
        }
    if turn == 3:
        return {
            "text": f"{(name + ', ') if name else ''}explain how INNER JOIN differs from LEFT JOIN in SQL.",
            "category": "Technical",
            "keywords": ["sql", "join"],
            "hint": "Use a simple table example. Employment is not required.",
            "topic": "SQL",
            "focus": "structured-theory-3",
        }
    if turn == 4:
        return {
            "text": f"{(name + ', ') if name else ''}in simple terms, explain one basic idea in {other} — keep it short.",
            "category": "Technical",
            "keywords": [other.lower(), "skill"],
            "hint": "Explain the concept in simple words. No job story is required.",
            "topic": other,
            "focus": "structured-theory-4",
        }
    if turn == 5:
        body = _fresher_project_question_text(1, project_line)
        return {
            "text": f"{(name + ', ') if name else ''}{body}".strip(),
            "category": "Experience",
            "keywords": ["project", "built", "tools"],
            "hint": "Talk about a real academic or personal project.",
            "topic": "Project contribution",
            "focus": "structured-project-1",
        }
    if turn == 6:
        body = _fresher_project_question_text(2, project_line, last_answer)
        return {
            "text": f"{(name + ', ') if name else ''}{body}".strip(),
            "category": "Problem Solving",
            "keywords": ["project", "testing", "debug"],
            "hint": "Stay on the same project and get more technical.",
            "topic": "Project technical",
            "focus": "structured-project-2",
        }
    return {
        "text": f"{name}, {FRESHER_THANK_YOU[0].lower()}{FRESHER_THANK_YOU[1:]}" if name else FRESHER_THANK_YOU,
        "category": "Communication",
        "keywords": ["closing", "thanks"],
        "hint": "A brief, professional sign-off is fine.",
        "topic": "Closing",
        "focus": "structured-closing",
    }


async def generate_adaptive_question(input: dict) -> dict:
    from app.services.interview_llm_questions import generate_adaptive_question_llm

    return await generate_adaptive_question_llm(input)


async def generate_adaptive_question_batch(input: dict) -> dict:
    from app.services.interview_llm_questions import generate_adaptive_question_batch_llm

    return await generate_adaptive_question_batch_llm(input)


def resolve_interview_total_turns(profile: dict | None, level: str, ctx: dict | None = None) -> int:
    if _is_fresher(profile, level, ctx):
        return FRESHER_INTERVIEW_TURN_COUNT
    return EXPERIENCED_INTERVIEW_TURN_COUNT  # 1 opening + 3 skills + 2 projects + fallback + closing


async def generate_vendor_job_question(input: dict, _options: dict | None = None) -> dict:
    from app.services.interview_llm_questions import generate_adaptive_question_llm

    enriched = {**input, "jobDescription": input.get("jobDescription") or ""}
    q = await generate_adaptive_question_llm(enriched)
    return {**q, "focus": "vendor-jd-llm"}


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


def _drop_unscored_turns(questions: list, answers: list) -> tuple[list, list]:
    """The closing sign-off is not a question: exclude it (and its answer) from scoring."""
    keep = [
        i
        for i, q in enumerate(questions)
        if not (isinstance(q, dict) and q.get("focus") in ("structured-closing", "pending-closing"))
    ]
    return [questions[i] for i in keep], [answers[i] if i < len(answers) else "" for i in keep]


async def score_interview_session(input: dict) -> dict:
    scored_questions, scored_answers = _drop_unscored_turns(input.get("questions") or [], input.get("answers") or [])
    input = {**input, "questions": scored_questions, "answers": scored_answers}
    kwargs = {
        "role": input.get("role") or "Full Stack Engineer",
        "level": input.get("level") or "1–3 years",
        "questions": input.get("questions") or [],
        "answers": input.get("answers") or [],
        "profile": input.get("profile"),
        "integrity": input.get("integrity"),
        "name": input.get("accountName") or "Candidate",
        "duration_seconds": input.get("durationSeconds"),
    }
    if llm_eval_configured():
        return await score_session_async(**kwargs)
    return score_session(**kwargs)


async def parse_resume_with_ai(text: str) -> dict | None:
    if len(str(text or "").strip()) < 40:
        return None
    ctx = summarize_profile({"resumeText": text}, "Candidate")
    return {
        "fullName": resolve_candidate_name({"resumeText": text}, ""),
        "skills": ctx.get("skills") or [],
        "resumeText": text[:50000],
    }


def vendor_skill_focus(skill_analysis: dict | None, required_skills: list | None, limit: int = 3) -> list[str]:
    """Skills for the skill-question turns of a vendor job interview.

    Skills found in BOTH the job description and the resume come first (in JD order), so questions test what
    the candidate claims and the job needs; if fewer than `limit` match, the rest of the JD skills fill in.
    """
    analysis = skill_analysis or {}
    jd_skills = [str(s).strip() for s in (analysis.get("jdSkills") or required_skills or []) if str(s).strip()]
    matched = {str(s).strip().lower() for s in analysis.get("matchedSkills") or [] if str(s).strip()}
    ordered = [s for s in jd_skills if s.lower() in matched]
    ordered += [s for s in analysis.get("matchedSkills") or [] if str(s).strip() and str(s).strip().lower() not in {o.lower() for o in ordered}]
    for s in jd_skills:
        if len(ordered) >= limit:
            break
        if s.lower() not in {o.lower() for o in ordered}:
            ordered.append(s)
    return [str(s) for s in ordered[:limit]]


def build_jd_coverage_plan(**kwargs) -> dict:
    jd = str(kwargs.get("jobDescription") or "")
    skills = kwargs.get("requiredSkills") or extract_primary_skills_from_jd(jd, [])
    return {"skills": skills, "topics": skills[:6]}


def resolve_exact_interview_role(profile: dict | None, role: str) -> str:
    profile = profile or {}
    return str(profile.get("currentRole") or role or "Software professional")
