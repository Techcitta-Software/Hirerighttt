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


def _name_words(value: Any) -> list[str]:
    return [w for w in re.sub(r"[^a-z\s]", " ", str(value or "").lower()).split() if len(w) >= 2]


def same_name_person(a: Any, b: Any) -> bool:
    """Same person if every word of the shorter name appears in the longer one ("Bharath" vs "Bharath Krishna P")."""
    x, y = _name_words(a), _name_words(b)
    if not x or not y:
        return False
    short, long_ = (x, y) if len(x) <= len(y) else (y, x)
    return all(w in long_ for w in short)


def _name_from_resume_text(resume: str) -> str:
    for line in resume.splitlines()[:10]:
        line = line.strip()
        if 4 <= len(line) <= 64 and re.match(r"^[A-Z][A-Za-z.'-]+(\s+[A-Z][A-Za-z.'-]+){0,4}$", line):
            return line
    return ""


def resolve_candidate_name(profile: dict[str, Any] | None, account_name: str = "") -> str:
    """The name Ava should use.

    A saved profile name wins only while it still matches the current resume or the account name. A saved name that
    matches neither is stale (left over from an older resume) and is ignored, so a new resume or the name the person
    signed up with takes over.
    """
    p = profile or {}
    saved = _clean(p.get("fullName")) or _clean(p.get("name"))
    saved = saved if saved and saved != DEMO_ACCOUNT_NAME else ""
    resume_name = _name_from_resume_text(_clean(p.get("resumeText")))
    acct = _clean(account_name)
    acct = acct if acct and acct != DEMO_ACCOUNT_NAME else ""

    if saved:
        evidence = [e for e in (resume_name, acct) if e]
        if not evidence or any(same_name_person(saved, e) for e in evidence):
            return saved
    if resume_name:
        return resume_name
    if acct:
        return acct

    resume_file = _clean(p.get("resumeName"))
    if resume_file:
        stem = re.sub(r"\.[^/.]+$", "", resume_file).replace("_", " ").replace("-", " ")
        stem = re.sub(
            r"\b(resume|cv|biodata|profile|fullstack|frontend|backend|engineer|developer)\b",
            "",
            stem,
            flags=re.I,
        ).strip()
        words = [w for w in stem.split() if len(w) >= 2 and w.isalpha()]
        if 2 <= len(words) <= 4:
            return " ".join(w.capitalize() for w in words)

    return saved or "Candidate"


def first_name_from_full(full: str) -> str:
    n = _clean(full)
    if not n or n == "Candidate":
        return "there"
    return " ".join(n.split())


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


def _normalize_role_name(value: str) -> str:
    v = re.sub(r"[^a-z0-9#+/ ]+", " ", value.lower().replace("-", " "))
    v = re.sub(r"\b(senior|sr|junior|jr|lead|principal|staff|associate|intern|trainee|i|ii|iii)\b", " ", v)
    v = re.sub(r"\bengineers?\b", "developer", v)
    v = re.sub(r"\bprogrammers?\b", "developer", v)
    return re.sub(r"\s+", " ", v).strip()


def _load_required_role_skills(role: str, profile: dict[str, Any] | None) -> list[str]:
    import json
    from pathlib import Path

    exact = _clean((profile or {}).get("currentRole")) or _clean(role)
    path = Path(__file__).resolve().parents[2] / "data" / "roleSkills.json"
    try:
        catalog = json.loads(path.read_text(encoding="utf-8"))
    except OSError:
        return []
    for candidate in (_clean(role), exact):
        if candidate in catalog and isinstance(catalog[candidate], list):
            return [str(s) for s in catalog[candidate][:3]]
    # Tolerant match: "Senior Full Stack Engineer" -> "Full Stack Developer".
    for candidate in (_clean(role), exact):
        key = _normalize_role_name(candidate)
        if not key:
            continue
        for display, skills in catalog.items():
            if _normalize_role_name(str(display)) == key and isinstance(skills, list):
                return [str(s) for s in skills[:3]]
    return []


def _analyze_answer_detailed(
    question: dict[str, Any],
    answer: str,
    ctx: dict[str, Any],
    llm_row: dict[str, Any] | None = None,
    role_skills: list[str] | None = None,
) -> dict[str, Any]:
    from app.services.interview_rubric_scoring import (
        build_weighted_rubrics,
        classify_question_scoring_profile,
        compute_heuristic_rubric_scores,
        merge_rubric_scores,
        weighted_question_score,
    )
    from app.services.role_skills_fit_scoring import compute_question_role_skills_fit

    base = _analyze_answer(question, answer, ctx)
    heuristic = compute_heuristic_rubric_scores(question, answer, ctx)
    role_fit = compute_question_role_skills_fit(question, answer, ctx, role_skills or [])
    if role_fit is not None:
        heuristic["roleSkillsFit"] = role_fit
    merged = merge_rubric_scores(heuristic, llm_row)
    from app.services.answer_quality import HEURISTIC_CEILING, apply_quality_gate, assess_answer_quality

    quality = assess_answer_quality(question, answer, ctx)
    merged = apply_quality_gate(merged, quality) | {
        "feedback": merged.get("feedback"),
        "source": merged.get("source", "heuristic"),
    }
    profile = _clean(question.get("scoringProfile")) or heuristic.get("scoringProfile") or classify_question_scoring_profile(question)
    rubrics = build_weighted_rubrics(merged, profile)
    question_score = weighted_question_score(rubrics)
    if merged.get("source") != "llm":
        question_score = min(question_score, HEURISTIC_CEILING)
    if quality["empty"]:
        question_score = 0
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
    if quality["empty"]:
        feedback = "No answer was captured for this question."
    elif "keyword_stuffing" in quality["flags"] or "repetitive" in quality["flags"]:
        feedback = "The answer repeated terms without explaining anything. Answer in full sentences with a real example."
    elif "off_topic" in quality["flags"]:
        feedback = "The answer did not address the question that was asked."
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
        "qualityFlags": quality["flags"],
    }


def _candidate_is_fresher(profile: dict[str, Any] | None, level: str, ctx: dict[str, Any]) -> bool:
    """Fresher interviews have one fewer scored question than experienced ones."""
    from app.services.interview_api import _is_fresher  # imported here: interview_api imports this module

    try:
        return bool(_is_fresher(profile, level, ctx))
    except Exception:
        return False


def _trusted_answers(questions: list[dict[str, Any]], answers: list[str], ctx: dict[str, Any]) -> list[str]:
    """Blank out answers that fail the quality gate so they cannot earn resume-fit or skill credit."""
    from app.services.answer_quality import assess_answer_quality

    out: list[str] = []
    for i, ans in enumerate(answers):
        q = questions[i] if i < len(questions) else {}
        out.append("" if assess_answer_quality(q, ans, ctx)["flags"] else ans)
    return out


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
    reliable: bool = True,
    duration_seconds: int | None = None,
    dimension_scores: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    from app.services.interview_rubric_scoring import INTERVIEW_RUBRICS

    rubric_session = [{"label": d["label"], "score": d["score"]} for d in (dimension_scores or [])]

    donuts = [
        {"label": r["label"], "score": r["score"], "tag": _tag_for_score(r["score"]), "color": _color_for_score(r["score"])}
        for r in rubric_session
    ]
    health_metrics = [
        {**d, "icon": ["📎", "🧭", "📈"][i] if i < 3 else "🎯"} for i, d in enumerate(donuts)
    ]

    def _rubric_map(rubrics: list[dict[str, Any]] | None) -> dict[str, int | None]:
        return {str(r.get("id")): r.get("score") for r in (rubrics or []) if r.get("id")}

    qa_rows = []
    for i, a in enumerate(analyses):
        fb = int(a.get("score") or 0)
        rub = _rubric_map(a.get("rubrics"))
        correctness_score = int(rub["correctness"]) if rub.get("correctness") is not None else None
        depth_score = int(rub["depth"]) if rub.get("depth") is not None else fb
        communication_score = int(rub["communication"]) if rub.get("communication") is not None else fb
        role_skills_fit_score = int(rub["roleSkillsFit"]) if rub.get("roleSkillsFit") is not None else None
        accuracy = min(10, round((correctness_score or 0) / 10)) if correctness_score is not None else 0
        clarity = min(10, round(communication_score / 10))
        depth = min(10, round(depth_score / 10))
        understanding = min(10, round(((correctness_score or communication_score) + communication_score) / 20))
        total30 = min(30, accuracy + clarity + depth)
        stars = "★" * max(1, round(fb / 20)) + "☆" * (5 - max(1, round(fb / 20)))
        qa_rows.append(
            {
                "index": i + 1,
                "topic": a.get("topic") or "Interview",
                "question": a.get("question"),
                "questionScore": fb,
                "correctnessScore": correctness_score,
                "depthScore": depth_score,
                "communicationScore": communication_score,
                "roleSkillsFitScore": role_skills_fit_score,
                "accuracy": accuracy,
                "clarity": clarity,
                "understanding": understanding,
                "depth": depth,
                "total30": total30,
                "total40": total30,
                "stars": stars[:5],
                "performance": a.get("performance"),
                "feedback": a.get("feedback"),
                "rubrics": a.get("rubrics"),
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
    if not reliable:
        status = "Provisional — AI evaluation unavailable"
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
            "durationMinutes": round(duration_seconds / 60) if duration_seconds else None,
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
    role_skills_analysis: dict[str, Any] | None = None,
    duration_seconds: int | None = None,
    fresher: bool = False,
) -> dict[str, Any]:
    from app.services.interview_rubric_scoring import INTERVIEW_RUBRICS
    from app.services.interview_weighting import compute_weighted_score

    llm_scored = bool(analyses) and all(a.get("rubricSource") == "llm" for a in analyses)
    scoring = {
        "mode": "llm" if llm_scored else "heuristic",
        "reliable": llm_scored,
        "notice": None
        if llm_scored
        else "Provisional score: AI evaluation was unavailable, so this result uses basic checks only and should be reviewed by a person.",
    }

    joined_for_fit = " ".join(a["answer"] for a in analyses if not a.get("qualityFlags") and a.get("answer")).lower()
    skills_referenced_early = [s for s in ctx["skills"] if s.lower() in joined_for_fit]
    role_skills_analysis = role_skills_analysis or {}
    if role_skills_analysis.get("requiredSkills"):
        role_fit_score = int(role_skills_analysis.get("fitScore") or 0)
    else:
        role_fit_score = min(
            100,
            round((len(skills_referenced_early) / max(min(len(ctx["skills"]), 5), 1)) * 70)
            + (20 if any(a.get("resumeSkillsHit") for a in analyses) else 0),
        )

    # Each question carries a fixed share of the score (technical 15%, others 10%); the rest is role fit.
    weighted = compute_weighted_score(
        questions=questions, analyses=analyses, fresher=fresher, role_fit_score=role_fit_score
    )
    categories = [{"label": d["label"], "score": d["score"]} for d in weighted["dimensions"]]
    rubric_agg: dict[str, list[int]] = {r["id"]: [] for r in INTERVIEW_RUBRICS}
    for a in analyses:
        for r in a.get("rubrics") or []:
            if r.get("score") is not None:
                rubric_agg.setdefault(r["id"], []).append(int(r.get("score") or 0))
    overall = int(weighted["overall"])
    score_model = weighted["model"]
    if score_model["answeredQuestions"] < score_model["plannedQuestions"]:
        incomplete = (
            f"Only {score_model['answeredQuestions']} of {score_model['plannedQuestions']} planned questions were answered. "
            "Each question carries a fixed share of the score, so unanswered questions count as 0."
        )
        scoring["notice"] = f"{scoring['notice']} {incomplete}".strip() if scoring.get("notice") else incomplete
    joined = " ".join(
        a["answer"] for a in analyses if not a.get("qualityFlags") and a.get("answer")
    ).lower()
    skills_referenced = skills_referenced_early
    resume_fit_score = role_fit_score

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

    if role_skills_analysis.get("requiredSkills"):
        req = role_skills_analysis["requiredSkills"]
        on_resume = role_skills_analysis.get("onResume") or []
        evidenced = role_skills_analysis.get("evidencedInAnswers") or []
        if on_resume:
            strengths.append(f"Role skills on résumé: {len(on_resume)}/{len(req)} ({', '.join(on_resume)}).")
        if len(evidenced) >= min(2, len(req)):
            strengths.append(
                f"Answers evidenced {len(evidenced)}/{len(req)} required role skills in this interview."
            )
        else:
            missing = [s for s in req if s not in evidenced]
            if missing:
                improvements.append(f"Mention required role skills in answers: {', '.join(missing)}.")
    elif len(skills_referenced) >= 2:
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
        reliable=scoring["reliable"],
        duration_seconds=duration_seconds,
        dimension_scores=categories,
    )

    return {
        "role": role,
        "level": level,
        "date": datetime.now(UTC).isoformat(),
        "overall": overall,
        "resumeFitScore": resume_fit_score,
        "scoreModel": score_model,
        "categories": categories,
        "strengths": strengths_out,
        "improvements": improvements_out,
        "answers": [{k: v for k, v in a.items() if k != "resumeSkillsHit"} for a in analyses],
        "roleSkillsAnalysis": role_skills_analysis,
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
        "scoring": scoring,
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
    duration_seconds: int | None = None,
) -> dict[str, Any]:
    from app.services.interview_llm_eval import evaluate_answers_with_llm, llm_eval_configured
    from app.services.role_skills_fit_scoring import compute_session_role_skills_fit

    ctx = summarize_profile(profile, name=name)
    integrity = integrity or {}
    role_skills = _load_required_role_skills(role, profile or {})
    role_skills_analysis = compute_session_role_skills_fit(ctx, role_skills, _trusted_answers(questions, answers, ctx))
    fresher = _candidate_is_fresher(profile, level, ctx)
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
        _analyze_answer_detailed(
            q,
            answers[i] if i < len(answers) else "",
            ctx,
            llm_by_index.get(i + 1) if llm_by_index else None,
            role_skills,
        )
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
        role_skills_analysis=role_skills_analysis,
        duration_seconds=duration_seconds,
        fresher=fresher,
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
    duration_seconds: int | None = None,
) -> dict[str, Any]:
    from app.services.role_skills_fit_scoring import compute_session_role_skills_fit

    ctx = summarize_profile(profile, name=name)
    integrity = integrity or {}
    role_skills = _load_required_role_skills(role, profile or {})
    role_skills_analysis = compute_session_role_skills_fit(ctx, role_skills, _trusted_answers(questions, answers, ctx))
    fresher = _candidate_is_fresher(profile, level, ctx)
    analyses = [
        _analyze_answer_detailed(q, answers[i] if i < len(answers) else "", ctx, None, role_skills)
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
        agent="python-resume-agent",
        role_skills_analysis=role_skills_analysis,
        duration_seconds=duration_seconds,
        fresher=fresher,
    )
