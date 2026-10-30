"""
Local resume-aware interview agent (no external LLM required).
Mirrors the frontend/local agent so scoring stays consistent server-side.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

STOP = {
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "have",
    "has",
    "were",
    "been",
    "your",
    "into",
    "over",
    "under",
    "about",
    "using",
    "used",
    "work",
    "working",
    "experience",
    "skilled",
    "skills",
    "responsible",
    "team",
    "project",
    "projects",
    "company",
    "role",
    "years",
    "year",
}

TECH_RE = re.compile(
    r"\b(?:React(?:\.js)?|Next\.js|Node(?:\.js)?|TypeScript|JavaScript|Python|Java|"
    r"Kotlin|Swift|Go|Golang|Rust|C\+\+|C#|\.NET|SQL|PostgreSQL|MySQL|MongoDB|Redis|"
    r"AWS|Azure|GCP|Docker|Kubernetes|Kafka|GraphQL|REST|Django|Flask|Spring|Angular|"
    r"Vue(?:\.js)?|Tailwind|Figma|Excel|Power BI|TensorFlow|PyTorch|Spark|Hadoop|"
    r"Linux|Git|CI\/CD|Selenium|Jest|Cypress)\b",
    re.I,
)

STRUCTURE_SIGNALS = [
    "for example",
    "first",
    "then",
    "finally",
    "as a result",
    "because",
    "situation",
    "task",
    "action",
    "result",
    "so i",
    "which led",
    "in the end",
]

CATEGORIES = ["Communication", "Technical", "Problem Solving", "Experience"]
DEMO_ACCOUNT_NAME = "Arjun Sharma"


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _unique(items: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for item in items:
        t = item.strip()
        key = t.lower()
        if t and key not in seen:
            seen.add(key)
            out.append(t)
    return out


def resolve_candidate_name(profile: dict[str, Any] | None, account_name: str = "") -> str:
    p = profile or {}
    from_profile = _clean(p.get("fullName")) or _clean(p.get("name"))
    if from_profile and from_profile != DEMO_ACCOUNT_NAME:
        return from_profile

    resume = _clean(p.get("resumeText"))
    if resume:
        for line in resume.splitlines()[:10]:
            line = line.strip()
            if 4 <= len(line) <= 64 and re.match(
                r"^[A-Z][A-Za-z.'-]+(\s+[A-Z][A-Za-z.'-]+){0,4}$", line
            ):
                return line

    resume_name = _clean(p.get("resumeName"))
    if resume_name:
        stem = re.sub(r"\.[^/.]+$", "", resume_name).replace("_", " ").replace("-", " ")
        stem = re.sub(
            r"\b(resume|cv|biodata|profile|fullstack|frontend|backend|engineer|developer)\b",
            "",
            stem,
            flags=re.I,
        ).strip()
        words = [w for w in stem.split() if len(w) >= 2 and w.isalpha()]
        if 2 <= len(words) <= 4:
            return " ".join(w.capitalize() for w in words)

    if from_profile:
        return from_profile
    acct = _clean(account_name)
    if acct and acct != DEMO_ACCOUNT_NAME:
        return acct
    return from_profile or acct or "Candidate"


def first_name_from_full(full: str) -> str:
    n = _clean(full)
    if not n or n == "Candidate":
        return "there"
    return n.split()[0]


def summarize_profile(profile: dict[str, Any] | None, name: str = "Candidate") -> dict[str, Any]:
    p = profile or {}
    account = name if name and name not in ("Candidate", DEMO_ACCOUNT_NAME) else ""
    if not account and name == DEMO_ACCOUNT_NAME:
        account = name
    resolved = resolve_candidate_name(p, account)
    skills = _unique([_clean(s) for s in (p.get("skills") or [])])[:16]
    jobs = []
    for w in (p.get("workExperiences") or [])[:4]:
        if not isinstance(w, dict):
            continue
        title = _clean(w.get("jobTitle")) or "Role"
        company = _clean(w.get("company")) or "Company"
        desc = _clean(w.get("description") or w.get("responsibilities"))
        line = f"{title} @ {company}"
        if desc:
            line += f": {desc[:180]}"
        jobs.append(line)
    achievements = [_clean(a) for a in (p.get("achievements") or []) if _clean(a)][:5]
    certs = [
        _clean(c.get("name"))
        for c in (p.get("certifications") or [])
        if isinstance(c, dict) and _clean(c.get("name"))
    ][:5]
    return {
        "name": resolved,
        "role": _clean(p.get("currentRole")) or "Software professional",
        "experience": _clean(p.get("totalExperience")) or "Not specified",
        "skills": skills,
        "whoAreYou": _clean(p.get("whoAreYou"))[:600],
        "whatDrivesYou": _clean(p.get("whatDrivesYou"))[:400],
        "keyStrengths": _clean(p.get("keyStrengths"))[:400],
        "experienceSummary": _clean(p.get("experienceSummary"))[:800],
        "jobs": jobs,
        "achievements": achievements,
        "certs": certs,
        "resumeSnippet": _clean(p.get("resumeText"))[:3500],
        "resumeName": p.get("resumeName"),
    }


def _extract_tokens(resume_text: str, known_skills: list[str]) -> list[str]:
    lower = resume_text.lower()
    from_known = [s for s in known_skills if s.lower() in lower]
    tech = TECH_RE.findall(resume_text or "")
    return _unique([*from_known, *tech])[:12]


def _extract_projects(resume_text: str) -> list[str]:
    lines = [line.strip() for line in re.split(r"\n|[•●▪‣]", resume_text or "")]
    lines = [line for line in lines if 28 < len(line) < 220]
    projectish = [
        line
        for line in lines
        if re.search(
            r"\b(built|developed|designed|implemented|created|led|improved|reduced|increased|migrated|deployed|launched)\b",
            line,
            re.I,
        )
    ]
    return _unique(projectish)[:5]


def build_questions(
    role: str, level: str, profile: dict[str, Any] | None, name: str = "there"
) -> list[dict[str, Any]]:
    ctx = summarize_profile(profile, name=name)
    resume = ctx["resumeSnippet"]
    skills = _extract_tokens(resume, ctx["skills"])
    projects = _extract_projects(resume)
    achievements = ctx["achievements"]
    jobs = ctx["jobs"]
    target_role = ctx["role"] if ctx["role"] != "Software professional" else role

    questions: list[dict[str, Any]] = []

    questions.append(
        {
            "text": (
                f"{ctx['name']}, I read your resume for {target_role}. "
                "Summarize your background in about a minute — what should a hiring manager remember?"
                if resume
                else f"{ctx['name']}, introduce yourself for the {target_role} track ({level}). "
                "What stands out from your experience?"
            ),
            "category": "Communication",
            "keywords": _unique(
                [
                    "experience",
                    "project",
                    "skill",
                    "built",
                    target_role.lower(),
                    *[s.lower() for s in skills[:4]],
                ]
            ),
            "hint": "Background → top skills → one concrete win from your resume.",
            "focus": "intro",
        }
    )

    if skills:
        questions.append(
            {
                "text": (
                    f"Your resume highlights {', '.join(skills[:3])}. "
                    f"Walk me through a real project where you used {skills[0]} — "
                    "what you built, your role, and the result."
                ),
                "category": "Technical",
                "keywords": _unique(
                    [
                        skills[0].lower(),
                        *([skills[1].lower()] if len(skills) > 1 else []),
                        "project",
                        "built",
                        "result",
                        "impact",
                    ]
                ),
                "hint": "Name the skill, the project, your actions, and a metric.",
                "focus": "skill-depth",
            }
        )
    else:
        questions.append(
            {
                "text": (
                    f"What is your strongest technical skill for a {role} role, "
                    "and how have you applied it in a real project?"
                ),
                "category": "Technical",
                "keywords": ["skill", "project", "built", "result", role.lower()],
                "hint": "Pick one skill and give a production example.",
                "focus": "skill-depth",
            }
        )

    if projects:
        words = [w for w in re.split(r"\W+", projects[0].lower()) if len(w) > 4 and w not in STOP][:5]
        questions.append(
            {
                "text": (
                    f"On your resume you mention: “{projects[0][:150]}”. "
                    "What was the hardest part, and how did you solve it?"
                ),
                "category": "Problem Solving",
                "keywords": _unique(["problem", "solution", "approach", "result", "challenge", *words]),
                "hint": "STAR: situation → task → action → result.",
                "focus": "experience",
            }
        )
    elif jobs:
        questions.append(
            {
                "text": (
                    f"Looking at {jobs[0].split(':')[0]}, what was the toughest problem you owned end-to-end?"
                ),
                "category": "Problem Solving",
                "keywords": _unique(["problem", "solution", "approach", "result", "owned", "impact"]),
                "hint": "Be specific about your ownership and the outcome.",
                "focus": "experience",
            }
        )
    else:
        questions.append(
            {
                "text": (
                    "Describe a challenging problem from your experience and how you solved it step by step."
                ),
                "category": "Problem Solving",
                "keywords": ["problem", "solution", "approach", "result", "impact"],
                "hint": "Use STAR and include a measurable result.",
                "focus": "experience",
            }
        )

    if achievements:
        questions.append(
            {
                "text": (
                    f"You listed this achievement: “{achievements[0][:140]}”. "
                    "How did you personally drive that result?"
                ),
                "category": "Experience",
                "keywords": ["result", "impact", "led", "improved", "metric"],
                "hint": "Your contribution vs the team, plus a metric.",
                "focus": "achievement",
            }
        )
    elif len(skills) > 1:
        questions.append(
            {
                "text": (
                    f"Compare your depth in {skills[0]} versus {skills[1]}. "
                    "Give an example that proves the difference."
                ),
                "category": "Experience",
                "keywords": _unique([skills[0].lower(), skills[1].lower(), "example", "depth", "project"]),
                "hint": "Contrast two resume skills with proof.",
                "focus": "achievement",
            }
        )
    else:
        questions.append(
            {
                "text": (
                    "Tell me about a time you delivered under a tight deadline. "
                    "What did you prioritize and what shipped?"
                ),
                "category": "Experience",
                "keywords": ["deadline", "priority", "deliver", "shipped", "plan"],
                "hint": "Priorities, trade-offs, and the outcome.",
                "focus": "achievement",
            }
        )

    questions.append(
        {
            "text": (
                f"Based on your resume, how would you apply {skills[0]} in the first 90 days "
                f"as a {role}, and what would you learn next?"
                if skills
                else f"Where do you want to grow as a {role} over the next two years, "
                "based on your experience so far?"
            ),
            "category": "Communication",
            "keywords": _unique(["grow", "learn", "goal", "plan", *([skills[0].lower()] if skills else [])]),
            "hint": "Tie growth to skills already on your resume.",
            "focus": "growth",
        }
    )

    return questions[:6]


def _analyze_answer(question: dict[str, Any], answer: str, ctx: dict[str, Any]) -> dict[str, Any]:
    text = _clean(answer)
    lower = text.lower()
    words = [w for w in text.split() if w]
    word_count = len(words)

    length_score = 0
    if word_count >= 10:
        length_score = 8
    if word_count >= 30:
        length_score = 16
    if word_count >= 60:
        length_score = 28
    if word_count > 280:
        length_score = 22

    keywords = [str(k).lower() for k in (question.get("keywords") or [])]
    keywords_hit = [k for k in keywords if k and k in lower]
    denom = min(max(len(keywords), 1), 5)
    keyword_score = min(30, round((len(keywords_hit) / denom) * 30))

    structure_hits = sum(1 for s in STRUCTURE_SIGNALS if s in lower)
    structure_score = min(12, structure_hits * 4)

    has_numbers = bool(re.search(r"\d", text))
    tool_hit = bool(
        re.search(
            r"\b(react|node|python|sql|aws|docker|typescript|java|kafka|figma|excel)\b",
            text,
            re.I,
        )
    )
    specificity_score = (5 if has_numbers else 0) + (5 if tool_hit else 0)

    skills_hit = [s for s in ctx["skills"] if len(s) >= 2 and s.lower() in lower]
    resume_fit = min(20, len(skills_hit) * 3 + (2 if ctx["resumeSnippet"] and word_count > 40 else 0))

    score = min(100, length_score + keyword_score + structure_score + specificity_score + resume_fit)

    if word_count < 12:
        feedback = "Too brief for a hiring interview. Aim for 60–150 words with a concrete example."
    elif not keywords_hit and not skills_hit and ctx["skills"]:
        feedback = f"Connect the answer to skills on your resume (e.g. {', '.join(ctx['skills'][:3])})."
    elif structure_hits == 0:
        feedback = "Good content — structure it as situation → action → result for clarity."
    elif score >= 78:
        feedback = (
            f"Strong, resume-aligned answer (referenced: {', '.join(skills_hit[:2])})."
            if skills_hit
            else "Strong answer — specific, structured, and relevant."
        )
    else:
        feedback = "Solid base. Add a measurable outcome and name tools from your profile."

    return {
        "question": question.get("text", ""),
        "answer": text,
        "score": score,
        "wordCount": word_count,
        "keywordsHit": _unique([*keywords_hit, *skills_hit]),
        "feedback": feedback,
        "resumeSkillsHit": skills_hit,
    }


def _analyze_answer_detailed(
    question: dict[str, Any],
    answer: str,
    ctx: dict[str, Any],
    llm_row: dict[str, Any] | None = None,
) -> dict[str, Any]:
    from app.services.interview_rubric_scoring import (
        build_weighted_rubrics,
        classify_question_scoring_profile,
        compute_heuristic_rubric_scores,
        merge_rubric_scores,
        weighted_question_score,
    )

    base = _analyze_answer(question, answer, ctx)
    heuristic = compute_heuristic_rubric_scores(question, answer, ctx)
    merged = merge_rubric_scores(heuristic, llm_row)
    profile = _clean(question.get("scoringProfile")) or heuristic.get("scoringProfile") or classify_question_scoring_profile(question)
    rubrics = build_weighted_rubrics(merged, profile)
    question_score = weighted_question_score(rubrics)
    performance = (
        "Strong"
        if question_score >= 80
        else "Good"
        if question_score >= 65
        else "Fair"
        if question_score >= 45
        else "Needs work"
    )
    feedback = merged.get("feedback") or base["feedback"]
    return {
        **base,
        "score": question_score,
        "feedback": feedback,
        "wordCount": heuristic["wordCount"],
        "keywordsHit": heuristic["keywordsHit"],
        "resumeSkillsHit": heuristic["skillsHit"],
        "topic": question.get("topic") or question.get("category") or "Interview",
        "scoringProfile": profile,
        "rubrics": rubrics,
        "performance": performance,
        "rubricSource": merged.get("source", "heuristic"),
    }


def _tag_for_score(score: int) -> str:
    if score >= 75:
        return "Strong"
    if score >= 50:
        return "Moderate"
    if score >= 25:
        return "Developing"
    return "Needs work"


def _color_for_score(score: int) -> str:
    if score >= 75:
        return "#16a34a"
    if score >= 50:
        return "#ea580c"
    return "#dc2626"


def _build_interview_scorecard(
    *,
    ctx: dict[str, Any],
    analyses: list[dict[str, Any]],
    overall: int,
    role: str,
    level: str,
    resume_fit_score: int,
    strengths: list[str],
    improvements: list[str],
    question_count: int,
) -> dict[str, Any]:
    from app.services.interview_rubric_scoring import INTERVIEW_RUBRICS

    rubric_totals: dict[str, list[int]] = {r["id"]: [] for r in INTERVIEW_RUBRICS}
    for a in analyses:
        for r in a.get("rubrics") or []:
            rubric_totals.setdefault(r["id"], []).append(int(r.get("score") or 0))

    rubric_session = []
    for defn in INTERVIEW_RUBRICS:
        scores = rubric_totals.get(defn["id"]) or []
        score = round(sum(scores) / len(scores)) if scores else 0
        rubric_session.append({"label": defn["label"], "score": score})

    donuts = [
        {"label": r["label"], "score": r["score"], "tag": _tag_for_score(r["score"]), "color": _color_for_score(r["score"])}
        for r in rubric_session
    ]
    health_metrics = [
        {**d, "icon": ["📎", "🧭", "📈"][i] if i < 3 else "🎯"} for i, d in enumerate(donuts)
    ]

    qa_rows = []
    for i, a in enumerate(analyses):
        fb = int(a.get("score") or 0)
        stars = "★" * max(1, round(fb / 20)) + "☆" * (5 - max(1, round(fb / 20)))
        qa_rows.append(
            {
                "index": i + 1,
                "topic": a.get("topic") or "Interview",
                "question": a.get("question"),
                "questionScore": fb,
                "stars": stars[:5],
                "performance": a.get("performance"),
                "feedback": a.get("feedback"),
            }
        )

    career_score = min(980, max(50, overall * 10))
    status = (
        "Premium Market-Ready"
        if career_score >= 850
        else "Industry Ready"
        if career_score >= 700
        else "Growth Potential"
        if career_score >= 550
        else "Skill Enhancement Recommended"
    )
    name = _clean(ctx.get("name")).split()[0] or "You"

    return {
        "careerScore": career_score,
        "industryAlignment": max(1, min(99, resume_fit_score)),
        "donuts": donuts,
        "healthMetrics": health_metrics,
        "qaRows": qa_rows,
        "radarAxes": [
            *[{"label": r["label"], "val": r["score"]} for r in rubric_session],
            {"label": "Overall", "val": overall},
        ],
        "finalCareerStatus": status,
        "bandInterpretation": f"{name} scored {overall}/100 on the {role} ({level}) interview — {status}.",
        "sessionStats": {
            "durationMinutes": max(12, question_count * 4),
            "questionCount": question_count,
            "overallInterviewScore": overall,
            "interviewType": f"{role} · Adaptive AI Interview",
        },
        "coachNotes": (
            f"{name}, your interview score is {overall}/100. "
            f"{strengths[0] + '. ' if strengths else ''}"
            f"{('Focus next: ' + improvements[0]) if improvements else ''}"
        ).strip(),
    }


def _finalize_score_payload(
    *,
    role: str,
    level: str,
    questions: list[dict[str, Any]],
    answers: list[str],
    ctx: dict[str, Any],
    analyses: list[dict[str, Any]],
    integrity: dict[str, Any],
    agent: str,
) -> dict[str, Any]:
    from app.services.interview_rubric_scoring import INTERVIEW_RUBRICS

    rubric_agg: dict[str, list[int]] = {r["id"]: [] for r in INTERVIEW_RUBRICS}
    for a in analyses:
        for r in a.get("rubrics") or []:
            rubric_agg.setdefault(r["id"], []).append(int(r.get("score") or 0))

    categories = []
    for defn in INTERVIEW_RUBRICS:
        scores = rubric_agg.get(defn["id"]) or []
        score = round(sum(scores) / len(scores)) if scores else 0
        categories.append({"label": defn["label"], "score": score})

    overall = round(sum(a["score"] for a in analyses) / max(len(analyses), 1)) if analyses else 0
    joined = " ".join(answers or []).lower()
    skills_referenced = [s for s in ctx["skills"] if s.lower() in joined]
    resume_fit_score = min(
        100,
        round((len(skills_referenced) / max(min(len(ctx["skills"]), 5), 1)) * 70)
        + (20 if any(a.get("resumeSkillsHit") for a in analyses) else 0),
    )

    if len(ctx["skills"]) >= 3 and len(skills_referenced) >= 2:
        overall = min(100, overall + 4)
    if len(ctx["skills"]) >= 3 and not skills_referenced:
        overall = max(0, overall - 5)
    if integrity.get("singlePersonOk") is False:
        overall = max(0, overall - 8)
    if int(integrity.get("faceViolations") or 0) > 3:
        overall = max(0, overall - 5)
    if integrity.get("banned"):
        overall = 0

    strengths: list[str] = []
    improvements: list[str] = []
    avg_words = sum(a["wordCount"] for a in analyses) / max(len(analyses), 1)
    if avg_words >= 50:
        strengths.append("Answers are detailed enough for a live hiring screen.")
    else:
        improvements.append("Expand answers to roughly 60–150 words with concrete examples.")

    comm_scores = rubric_agg.get("communication") or []
    if comm_scores and round(sum(comm_scores) / len(comm_scores)) >= 75:
        strengths.append("Communication is clear and well structured.")
    corr_scores = rubric_agg.get("correctness") or []
    if corr_scores and round(sum(corr_scores) / len(corr_scores)) < 55:
        improvements.append("Tighten technical accuracy — answer the exact question asked.")

    if len(skills_referenced) >= 2:
        strengths.append(f"Resume alignment: you evidenced {', '.join(skills_referenced[:3])}.")
    elif ctx["skills"]:
        improvements.append(f"Reference skills from your resume ({', '.join(ctx['skills'][:3])}).")

    if categories:
        best = max(categories, key=lambda c: c["score"])
        worst = min(categories, key=lambda c: c["score"])
        if best["score"] >= 60:
            strengths.append(f"{best['label']} stands out ({best['score']}/100).")
        if worst["score"] < 60:
            improvements.append(f"Strengthen {worst['label']} ({worst['score']}/100).")
    if integrity.get("banned"):
        improvements.insert(0, integrity.get("banReason") or "Session banned for integrity.")

    strengths_out = _unique(strengths)[:6]
    improvements_out = _unique(improvements)[:6]

    scorecard = _build_interview_scorecard(
        ctx=ctx,
        analyses=analyses,
        overall=overall,
        role=role,
        level=level,
        resume_fit_score=resume_fit_score,
        strengths=strengths_out,
        improvements=improvements_out,
        question_count=len(questions),
    )

    return {
        "role": role,
        "level": level,
        "date": datetime.now(UTC).isoformat(),
        "overall": overall,
        "resumeFitScore": resume_fit_score,
        "categories": categories,
        "strengths": strengths_out,
        "improvements": improvements_out,
        "answers": [{k: v for k, v in a.items() if k != "resumeSkillsHit"} for a in analyses],
        "scorecard": scorecard,
        "integrity": {
            "faceViolations": int(integrity.get("faceViolations") or 0),
            "singlePersonOk": integrity.get("singlePersonOk") is not False,
            "maxFacesSeen": int(integrity.get("maxFacesSeen") or 1),
            "banned": bool(integrity.get("banned")),
            "banReason": integrity.get("banReason"),
            "sideLookWarnings": int(integrity.get("sideLookWarnings") or 0),
            "tooFarWarnings": int(integrity.get("tooFarWarnings") or 0),
        },
        "agent": agent,
    }


async def score_session_async(
    *,
    role: str,
    level: str,
    questions: list[dict[str, Any]],
    answers: list[str],
    profile: dict[str, Any] | None,
    integrity: dict[str, Any] | None = None,
    name: str = "Candidate",
) -> dict[str, Any]:
    from app.services.interview_llm_eval import evaluate_answers_with_llm, llm_eval_configured

    ctx = summarize_profile(profile, name=name)
    integrity = integrity or {}
    llm_by_index = None
    agent = "python-resume-agent"
    if llm_eval_configured():
        llm_by_index = await evaluate_answers_with_llm(
            questions=questions,
            answers=answers,
            ctx=ctx,
            role=role,
            level=level,
        )
        if llm_by_index:
            agent = "python-resume-agent+llm"

    analyses = [
        _analyze_answer_detailed(q, answers[i] if i < len(answers) else "", ctx, llm_by_index.get(i + 1) if llm_by_index else None)
        for i, q in enumerate(questions)
    ]
    return _finalize_score_payload(
        role=role,
        level=level,
        questions=questions,
        answers=answers,
        ctx=ctx,
        analyses=analyses,
        integrity=integrity,
        agent=agent,
    )


def score_session(
    *,
    role: str,
    level: str,
    questions: list[dict[str, Any]],
    answers: list[str],
    profile: dict[str, Any] | None,
    integrity: dict[str, Any] | None = None,
    name: str = "Candidate",
) -> dict[str, Any]:
    ctx = summarize_profile(profile, name=name)
    integrity = integrity or {}
    analyses = [
        _analyze_answer_detailed(q, answers[i] if i < len(answers) else "", ctx, None) for i, q in enumerate(questions)
    ]
    return _finalize_score_payload(
        role=role,
        level=level,
        questions=questions,
        answers=answers,
        ctx=ctx,
        analyses=analyses,
        integrity=integrity,
        agent="python-resume-agent",
    )
