"""Personalized interview adapter — port of backend-trial/node/assessment/personalized.mjs."""

from __future__ import annotations

import json
import re
from typing import Any

from psycopg.rows import dict_row

from app.assessment.contracts import BLUEPRINT, VERSION, AssessmentError, check, text, validate_plan
from app.assessment.provider import PLAN_PROMPT, structured_call
from app.assessment.service import _pool, _questions, actor_for_email

UUID_RE = re.compile(r"^[0-9a-f-]{36}$", re.I)
LABELS = [
    "Project ownership",
    "Role fundamentals",
    "Practical application",
    "Problem solving",
    "Troubleshooting",
    "Role specialization",
    "Design and trade-offs",
]


def _category(cid: str) -> str:
    if cid == "ownership":
        return "Experience"
    if cid in ("problem_solving", "troubleshooting", "deeper_reasoning"):
        return "Problem Solving"
    return "Technical"


def _qview(q: dict | None) -> dict | None:
    if not q:
        return None
    return {
        "id": q.get("question_id"),
        "text": q.get("question_text"),
        "category": _category(str(q.get("competency") or "")),
        "keywords": [],
        "hint": "",
        "topic": q.get("competency"),
    }


def wants_personalized(path: str, method: str, body: dict | None) -> bool:
    body = body or {}
    if method == "GET" and re.fullmatch(r"/api/interview/session/[0-9a-f-]{36}", path, re.I):
        return True
    if method != "POST" or path not in ("/api/interview/start", "/api/interview/next", "/api/interview/score", "/api/interview/turn"):
        return False
    if path == "/api/interview/start":
        return body.get("consent") is True and isinstance(body.get("requestId"), str) and str(body.get("requestId")).strip()
    return bool(UUID_RE.match(str(body.get("sessionId") or "")))


async def handle_personalized(path: str, method: str, email: str, body: dict) -> dict:
    actor = actor_for_email(email)
    if method == "GET":
        return _get(actor, path.rsplit("/", 1)[-1])
    if path.endswith("/start"):
        return await _start(actor, body)
    if path.endswith("/next"):
        return _get(actor, str(body.get("sessionId")))
    if path.endswith("/turn"):
        _get(actor, str(body.get("sessionId")))
        return {"spoken": "Thank you. Let’s continue.", "source": "quick_response"}
    return {"interview": _get(actor, str(body.get("sessionId")))}


def _get(actor: dict, sid: str) -> dict:
    with _pool().connection() as conn:
        conn.row_factory = dict_row
        session = conn.execute("SELECT * FROM assessment_sessions WHERE id=%s AND candidate_id=%s", (sid, actor["id"])).fetchone()
        check(session, "Interview not found", 404)
        link = conn.execute(
            "SELECT * FROM personalized_interview_links WHERE session_id=%s AND candidate_id=%s",
            (sid, actor["id"]),
        ).fetchone()
        check(link, "Interview not found", 404)
        questions = _questions(conn, session["plan_id"])
        job = conn.execute(
            "SELECT j.* FROM assessment_jobs j JOIN interview_plans p ON p.job_id=j.id WHERE p.id=%s",
            (session["plan_id"],),
        ).fetchone()
        answers = conn.execute(
            "SELECT question_id, answer_text FROM interview_answers WHERE session_id=%s ORDER BY created_at",
            (sid,),
        ).fetchall()
    idx = int(session.get("current_index") or 0)
    visible = [_qview(q) for q in questions[: min(7, idx + 1)]]
    return {
        "sessionId": str(session["id"]),
        "role": (job or {}).get("title"),
        "level": (job or {}).get("experience_level"),
        "status": session["status"],
        "version": session["version"],
        "questionIndex": idx,
        "question": _qview(questions[idx] if idx < len(questions) else None),
        "questions": visible,
        "answers": [next((a["answer_text"] for a in answers if a["question_id"] == q.get("question_id")), None) for q in questions],
        "total": 7,
        "adaptive": True,
        "llm": True,
        "agent": "rubric-assessment",
        "jobId": link.get("job_id"),
        "applicationId": link.get("application_id"),
    }


async def _start(actor: dict, body: dict) -> dict:
    check(actor["role"] == "jobseeker", "Candidate account required", 403)
    request_id = text(body.get("requestId"), "start request ID", 100)
    with _pool().connection() as conn:
        conn.row_factory = dict_row
        prev = conn.execute(
            "SELECT session_id FROM personalized_interview_links WHERE candidate_id=%s AND request_id=%s",
            (actor["id"], request_id),
        ).fetchone()
        if prev:
            return _get(actor, str(prev["session_id"]))
        profile_row = conn.execute(
            "SELECT data FROM profiles WHERE user_id=%s OR email=%s",
            (actor["id"], actor["email"]),
        ).fetchone()
    profile = {}
    if profile_row and profile_row.get("data"):
        profile = profile_row["data"] if isinstance(profile_row["data"], dict) else json.loads(profile_row["data"])
    profile.update(body.get("profile") or {})
    resume_text = text(profile.get("resumeText"), "resume text (upload your resume first)", 100000)
    skills = profile.get("skills") if isinstance(profile.get("skills"), list) else []
    check(skills, "Add at least one core skill before starting")
    title = text(body.get("role") or profile.get("currentRole") or "Engineer", "target role", 200)
    level = text(str(body.get("level") or profile.get("totalExperience") or "Not specified"), "experience level", 200)
    competencies = [
        {
            "id": BLUEPRINT[i],
            "name": LABELS[i],
            "weight": 10 if i == 6 else 15,
            "requirement": f"{LABELS[i]} for {title}. Essential skills: {', '.join(map(str, skills))}."[:2000],
        }
        for i in range(7)
    ]
    job = {"title": title, "description": f"Target role: {title}.", "experience_level": level, "competencies": competencies}
    generated = await structured_call(
        system=PLAN_PROMPT,
        payload={"job": job, "resume_text": resume_text, "blueprint": BLUEPRINT},
        purpose="plan",
        validate=lambda value: validate_plan(value, job, resume_text),
    )
    with _pool().connection() as conn:
        conn.row_factory = dict_row
        snap = conn.execute(
            """INSERT INTO assessment_jobs(organization_id,created_by,title,description,experience_level,competencies,personal_candidate_id)
               VALUES('org-platform',%s,%s,%s,%s,%s::jsonb,%s) RETURNING id""",
            (actor["id"], title, job["description"], level, json.dumps(competencies), actor["id"]),
        ).fetchone()
        plan = conn.execute(
            """INSERT INTO interview_plans(organization_id,candidate_id,job_id,model,prompt_version,status)
               VALUES('org-platform',%s,%s,%s,%s,'ready') RETURNING id""",
            (actor["id"], snap["id"], generated["model"], VERSION),
        ).fetchone()
        for q in generated["data"]["questions"]:
            conn.execute(
                "INSERT INTO interview_questions(plan_id,question_id,position,data) VALUES(%s,%s,%s,%s::jsonb)",
                (plan["id"], q["question_id"], q["position"], json.dumps(q)),
            )
        session = conn.execute(
            """INSERT INTO assessment_sessions(plan_id,organization_id,candidate_id,status,consent_at,started_at)
               VALUES(%s,'org-platform',%s,'in_progress',NOW(),NOW()) RETURNING id""",
            (plan["id"], actor["id"]),
        ).fetchone()
        conn.execute(
            """INSERT INTO personalized_interview_links(session_id,candidate_id,request_id)
               VALUES(%s,%s,%s)""",
            (session["id"], actor["id"], request_id),
        )
        conn.commit()
        sid = str(session["id"])
    return _get(actor, sid)
