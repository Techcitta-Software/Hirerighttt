"""Assessment HTTP + persistence — port of backend-trial/node/assessment routes used by the frontend."""

from __future__ import annotations

import base64
import json
import re
import uuid
import zipfile
from io import BytesIO
from typing import Any

from psycopg.rows import dict_row

from app.assessment.contracts import (
    VERSION,
    AssessmentError,
    aggregate,
    check,
    public_question,
    text,
    validate_competencies,
    validate_evaluation,
    validate_plan,
)
from app.assessment.provider import EVALUATION_PROMPT, PLAN_PROMPT, structured_call
from app.db.store import db_pool
from app.node_config import config


def _pool():
    if not config.database_url.strip():
        raise AssessmentError(503, "Database required for assessments.")
    return db_pool(config.database_url)


def _view(session: dict, questions: list) -> dict:
    idx = int(session.get("current_index") or 0)
    status = session.get("status")
    current = public_question(questions[idx]) if status in ("in_progress", "paused") and idx < len(questions) else None
    return {
        "session_id": str(session["id"]),
        "status": status,
        "version": session.get("version"),
        "current_question_index": idx,
        "current_question": current,
        "remaining_questions": max(0, 7 - idx),
        "total_questions": 7,
        "started_at": session.get("started_at"),
        "completed_at": session.get("completed_at"),
    }


def _questions(conn, plan_id) -> list[dict]:
    rows = conn.execute(
        "SELECT data FROM interview_questions WHERE plan_id=%s ORDER BY position",
        (plan_id,),
    ).fetchall()
    out = []
    for row in rows:
        data = row["data"]
        out.append(data if isinstance(data, dict) else json.loads(data))
    return out


def actor_for_email(email: str) -> dict:
    with _pool().connection() as conn:
        conn.row_factory = dict_row
        row = conn.execute("SELECT id, email, role, status FROM users WHERE email=%s", (email,)).fetchone()
    check(row and row.get("status") == "active", "Unauthorized", 401)
    return row


def _require_recruiter(conn, actor: dict, organization_id: str) -> None:
    check(actor.get("role") == "employer", "Recruiter account required", 403)
    row = conn.execute(
        """SELECT m.role FROM organization_members m
           JOIN organizations o ON o.id=m.organization_id
           WHERE m.user_id=%s AND m.organization_id=%s AND o.status='active'""",
        (actor["id"], organization_id),
    ).fetchone()
    check(row and row["role"] in ("owner", "admin", "recruiter"), "Organization access denied", 403)


def _load_session(conn, session_id: str, actor: dict, *, recruiter_only: bool = False, candidate_only: bool = False) -> dict:
    session = conn.execute("SELECT * FROM assessment_sessions WHERE id=%s", (session_id,)).fetchone()
    check(session, "Interview not found", 404)
    if candidate_only:
        check(session["candidate_id"] == actor["id"], "Interview not found", 404)
    elif recruiter_only or session["candidate_id"] != actor["id"]:
        _require_recruiter(conn, actor, session["organization_id"])
    return session


def extract_resume_text(body: dict) -> str:
    filename = body.get("filename") if isinstance(body.get("filename"), str) else ""
    check(re.search(r"\.(pdf|docx)$", filename, re.I) and len(filename) <= 200, "Only PDF and DOCX resumes are supported")
    raw = body.get("file_base64") or ""
    check(isinstance(raw, str) and len(raw) <= 2_800_000, "Invalid or oversized resume upload")
    buf = base64.b64decode(raw)
    check(0 < len(buf) <= 2_000_000, "Resume must be at most 2 MB")
    if filename.lower().endswith(".pdf"):
        check(buf[:5] == b"%PDF-", "File content does not match its extension")
        # Lightweight text pull; binary PDFs still yield what the stream contains.
        text_out = "".join(ch if 32 <= ord(ch) < 127 or ch in "\n\t" else " " for ch in buf.decode("latin1", errors="ignore"))
        text_out = re.sub(r"\s+", " ", text_out).strip()
    else:
        check(buf[:4] == b"PK\x03\x04", "File content does not match its extension")
        with zipfile.ZipFile(BytesIO(buf)) as zf:
            xml = zf.read("word/document.xml").decode("utf-8", errors="ignore")
        text_out = re.sub(r"<[^>]+>", " ", xml)
        text_out = re.sub(r"\s+", " ", text_out).strip()
    check(len(text_out) >= 40, "Could not extract enough text from the resume", 422)
    return text_out[:100_000]


async def handle(method: str, path: str, email: str, body: dict, query: dict) -> tuple[int, dict]:
    actor = actor_for_email(email)
    if path == "/api/assessments/jobs" and method == "GET":
        org = query.get("organization_id")
        with _pool().connection() as conn:
            conn.row_factory = dict_row
            if org:
                _require_recruiter(conn, actor, org)
                rows = conn.execute(
                    "SELECT id,title,description,experience_level,competencies,created_at FROM assessment_jobs WHERE organization_id=%s ORDER BY created_at DESC",
                    (org,),
                ).fetchall()
            else:
                check(actor["role"] == "jobseeker", "Candidate account required", 403)
                rows = conn.execute(
                    """SELECT j.id,j.title,j.description,j.experience_level,j.organization_id,j.created_at,o.name AS organization_name
                       FROM assessment_jobs j JOIN organizations o ON o.id=j.organization_id
                       WHERE j.personal_candidate_id IS NULL AND o.status='active'
                       ORDER BY j.created_at DESC LIMIT 50"""
                ).fetchall()
        return 200, {"jobs": rows}
    if path == "/api/assessments/jobs" and method == "POST":
        competencies = validate_competencies(body.get("competencies"))
        with _pool().connection() as conn:
            conn.row_factory = dict_row
            _require_recruiter(conn, actor, body.get("organization_id"))
            row = conn.execute(
                """INSERT INTO assessment_jobs(organization_id,created_by,title,description,experience_level,competencies)
                   VALUES(%s,%s,%s,%s,%s,%s::jsonb) RETURNING *""",
                (
                    body["organization_id"],
                    actor["id"],
                    text(body.get("title"), "job title", 200),
                    text(body.get("description"), "job description", 20000),
                    text(body.get("experience_level"), "experience level", 200),
                    json.dumps(competencies),
                ),
            ).fetchone()
            conn.commit()
        return 201, {"job": row}
    if path == "/api/assessments/resumes" and method == "POST":
        extracted = extract_resume_text(body)
        return await _save_resume(actor, body.get("filename") or "resume.pdf", extracted)
    if path == "/api/assessments/generate" and method == "POST":
        return await _generate(actor, body)
    if path == "/api/assessments" and method == "GET":
        org = query.get("organization_id") or ""
        limit = int(query.get("limit") or 25)
        offset = int(query.get("offset") or 0)
        with _pool().connection() as conn:
            conn.row_factory = dict_row
            _require_recruiter(conn, actor, org)
            rows = conn.execute(
                """SELECT id,candidate_id,plan_id,status,created_at,completed_at FROM assessment_sessions
                   WHERE organization_id=%s ORDER BY created_at DESC,id LIMIT %s OFFSET %s""",
                (org, limit, offset),
            ).fetchall()
        return 200, {"interviews": rows}
    match = re.match(r"^/api/assessments/([0-9a-f-]{36})(?:/([a-z-]+))?$", path, re.I)
    check(match, "Assessment endpoint not found", 404)
    sid, action = match.group(1), match.group(2)
    if not action and method == "GET":
        return 200, _get(actor, sid)
    if action == "plan" and method == "GET":
        return 200, _plan(actor, sid)
    if action == "approve" and method == "POST":
        return 200, _approve(actor, sid, body)
    if action in ("start", "pause", "cancel", "complete") and method == "POST":
        return 200, _transition(actor, sid, action, body)
    if action in ("messages", "answers") and method == "POST":
        return 200, await _message(actor, sid, body)
    if action == "repeat-question" and method == "POST":
        return 200, await _message(actor, sid, {"message": "repeat the question"})
    if action == "report" and method == "GET":
        return 200, _report(actor, sid)
    raise AssessmentError(404, "Assessment endpoint not found")


async def _save_resume(actor: dict, filename: str, extracted: str) -> tuple[int, dict]:
    check(actor["role"] == "jobseeker", "Candidate account required", 403)
    cleaned = text(extracted, "resume text", 100000)
    rid = str(uuid.uuid4())
    with _pool().connection() as conn:
        conn.execute(
            """INSERT INTO assessment_resumes(id,candidate_id,filename,extracted_text,expires_at)
               VALUES(%s,%s,%s,%s,NOW()+INTERVAL '30 days')""",
            (rid, actor["id"], text(filename, "filename", 200), cleaned),
        )
        conn.commit()
    return 201, {
        "resume_id": rid,
        "extracted_text": cleaned,
        "extraction_status": "needs_candidate_review",
        "notice": "Check and correct extracted text before generating an assessment.",
    }


async def _generate(actor: dict, body: dict) -> tuple[int, dict]:
    check(actor["role"] == "jobseeker", "Candidate account required", 403)
    check(body.get("consent") is True, "Consent to share this assessment with the job organization is required")
    with _pool().connection() as conn:
        conn.row_factory = dict_row
        job = conn.execute("SELECT * FROM assessment_jobs WHERE id=%s", (body.get("job_id"),)).fetchone()
        check(job, "Job not found", 404)
        resume = conn.execute(
            "SELECT extracted_text FROM assessment_resumes WHERE id=%s AND candidate_id=%s AND expires_at>NOW()",
            (body.get("resume_id"), actor["id"]),
        ).fetchone()
    check(resume, "Your unexpired resume is required", 404)
    if isinstance(job.get("competencies"), str):
        job["competencies"] = json.loads(job["competencies"])
    generated = await structured_call(
        system=PLAN_PROMPT,
        payload={"job": job, "resume_text": resume["extracted_text"]},
        purpose="plan",
        validate=lambda value: validate_plan(value, job, resume["extracted_text"]),
    )
    with _pool().connection() as conn:
        conn.row_factory = dict_row
        plan = conn.execute(
            """INSERT INTO interview_plans(organization_id,candidate_id,job_id,model,prompt_version)
               VALUES(%s,%s,%s,%s,%s) RETURNING id""",
            (job["organization_id"], actor["id"], job["id"], generated["model"], VERSION),
        ).fetchone()
        for q in generated["data"]["questions"]:
            conn.execute(
                "INSERT INTO interview_questions(plan_id,question_id,position,data) VALUES(%s,%s,%s,%s::jsonb)",
                (plan["id"], q["question_id"], q["position"], json.dumps(q)),
            )
        session = conn.execute(
            """INSERT INTO assessment_sessions(plan_id,organization_id,candidate_id,consent_at)
               VALUES(%s,%s,%s,NOW()) RETURNING *""",
            (plan["id"], job["organization_id"], actor["id"]),
        ).fetchone()
        conn.commit()
    return 201, {
        **_view(session, generated["data"]["questions"]),
        "plan_id": str(plan["id"]),
        "plan_status": "created",
        "awaiting_recruiter_approval": True,
    }


def _get(actor: dict, sid: str) -> dict:
    with _pool().connection() as conn:
        conn.row_factory = dict_row
        session = _load_session(conn, sid, actor)
        questions = _questions(conn, session["plan_id"])
        answers = conn.execute(
            "SELECT id,question_id,answer_text,status FROM interview_answers WHERE session_id=%s ORDER BY created_at",
            (sid,),
        ).fetchall()
        plan = conn.execute("SELECT status FROM interview_plans WHERE id=%s", (session["plan_id"],)).fetchone()
    return {**_view(session, questions), "plan_status": plan["status"] if plan else None, "answers": answers}


def _plan(actor: dict, sid: str) -> dict:
    with _pool().connection() as conn:
        conn.row_factory = dict_row
        session = _load_session(conn, sid, actor, recruiter_only=True)
        questions = _questions(conn, session["plan_id"])
        plan = conn.execute("SELECT * FROM interview_plans WHERE id=%s", (session["plan_id"],)).fetchone()
        job = conn.execute(
            """SELECT j.* FROM assessment_jobs j JOIN interview_plans p ON p.job_id=j.id WHERE p.id=%s""",
            (session["plan_id"],),
        ).fetchone()
    return {"plan": plan, "questions": questions, "job": job}


def _approve(actor: dict, sid: str, body: dict) -> dict:
    with _pool().connection() as conn:
        conn.row_factory = dict_row
        session = _load_session(conn, sid, actor, recruiter_only=True)
        check(session["status"] == "ready", "Plan cannot change after the interview starts", 409)
        check(int(body.get("version")) == int(session["version"]), "Session changed; reload and retry with its current version", 409)
        conn.execute(
            "UPDATE interview_plans SET status='ready',approved_by=%s,approved_at=NOW(),version=version+1 WHERE id=%s",
            (actor["id"], session["plan_id"]),
        )
        row = conn.execute(
            "UPDATE assessment_sessions SET version=version+1 WHERE id=%s RETURNING *",
            (sid,),
        ).fetchone()
        questions = _questions(conn, session["plan_id"])
        conn.commit()
    return _view(row, questions)


def _transition(actor: dict, sid: str, action: str, body: dict) -> dict:
    with _pool().connection() as conn:
        conn.row_factory = dict_row
        session = _load_session(conn, sid, actor, candidate_only=True)
        check(int(body.get("version")) == int(session["version"]), "Session changed; reload and retry with its current version", 409)
        questions = _questions(conn, session["plan_id"])
        if action == "start":
            check(session["status"] in ("ready", "paused"), "Interview cannot start in this state", 409)
            plan = conn.execute("SELECT status FROM interview_plans WHERE id=%s", (session["plan_id"],)).fetchone()
            check(plan and plan["status"] == "ready", "Recruiter approval required", 409)
            status = "in_progress"
        elif action == "pause":
            check(session["status"] == "in_progress", "Interview is not in progress", 409)
            status = "paused"
        else:
            check(session["status"] in ("ready", "in_progress", "paused"), "Interview has ended", 409)
            status = "cancelled" if action == "cancel" else "completed"
        row = conn.execute(
            """UPDATE assessment_sessions SET status=%s, version=version+1,
               started_at=CASE WHEN %s='in_progress' THEN COALESCE(started_at,NOW()) ELSE started_at END,
               completed_at=CASE WHEN %s IN ('completed','cancelled') THEN NOW() ELSE completed_at END
               WHERE id=%s RETURNING *""",
            (status, status, status, sid),
        ).fetchone()
        conn.commit()
    return _view(row, questions)


async def _message(actor: dict, sid: str, body: dict) -> dict:
    message = text(body.get("message"), "answer or message", 20000)
    with _pool().connection() as conn:
        conn.row_factory = dict_row
        session = _load_session(conn, sid, actor, candidate_only=True)
        questions = _questions(conn, session["plan_id"])
        if message.strip().lower() in ("repeat", "repeat the question", "repeat question"):
            q = questions[int(session.get("current_index") or 0)] if questions else None
            spoken = f"Of course! Here is the question again: {(q or {}).get('question_text') or 'No active question.'}"
            return {**_view(session, questions), "response": spoken, "intent": "repeat_question", "source": "quick_response"}
        check(int(body.get("version")) == int(session["version"]), "Session changed; reload and retry with its current version", 409)
        check(session["status"] == "in_progress", "Interview is not in progress", 409)
        question = questions[int(session.get("current_index") or 0)]
        check(question and question["question_id"] == body.get("question_id"), "Answer must match the active question", 409)
        request_id = text(body.get("request_id"), "request id", 100)
        answer = conn.execute(
            """INSERT INTO interview_answers(session_id,plan_id,question_id,request_id,answer_text,status)
               VALUES(%s,%s,%s,%s,%s,'submitted') RETURNING *""",
            (sid, session["plan_id"], question["question_id"], request_id, message),
        ).fetchone()
        updated = conn.execute(
            """UPDATE assessment_sessions SET current_index=current_index+1, version=version+1,
               status=CASE WHEN current_index=6 THEN 'completed' ELSE status END,
               completed_at=CASE WHEN current_index=6 THEN NOW() ELSE completed_at END
               WHERE id=%s RETURNING *""",
            (sid,),
        ).fetchone()
        conn.commit()
    view = {**_view(updated, questions), "answer_id": str(answer["id"]), "used_llm": True}
    try:
        generated = await structured_call(
            system=EVALUATION_PROMPT,
            payload={"question": question, "answer": message},
            purpose="evaluation",
            validate=lambda value: validate_evaluation(value, message),
        )
        with _pool().connection() as conn:
            conn.execute(
                """INSERT INTO answer_evaluations(answer_id,data,score,model,prompt_version,rubric_version)
                   VALUES(%s,%s::jsonb,%s,%s,%s,%s) ON CONFLICT(answer_id) DO NOTHING""",
                (answer["id"], json.dumps(generated["data"]), generated["data"]["score"], generated["model"], VERSION, VERSION),
            )
            conn.commit()
        view["evaluation_status"] = "evaluated"
    except AssessmentError:
        view["evaluation_status"] = "pending_retry"
    return view


def _report(actor: dict, sid: str) -> dict:
    with _pool().connection() as conn:
        conn.row_factory = dict_row
        session = _load_session(conn, sid, actor)
        check(session["status"] == "completed", "Report is available after completion", 409)
        questions = _questions(conn, session["plan_id"])
        job = conn.execute(
            "SELECT j.* FROM assessment_jobs j JOIN interview_plans p ON p.job_id=j.id WHERE p.id=%s",
            (session["plan_id"],),
        ).fetchone()
        if isinstance(job.get("competencies"), str):
            job["competencies"] = json.loads(job["competencies"])
        answers = conn.execute("SELECT * FROM interview_answers WHERE session_id=%s ORDER BY created_at", (sid,)).fetchall()
        evaluations = conn.execute(
            """SELECT e.* FROM answer_evaluations e JOIN interview_answers a ON a.id=e.answer_id WHERE a.session_id=%s""",
            (sid,),
        ).fetchall()
    report = {
        "session_id": sid,
        "candidate_id": session["candidate_id"],
        "job": job,
        "status": session["status"],
        **aggregate(job, questions, answers, evaluations),
        "questions": questions,
        "answers": answers,
        "evaluations": evaluations,
    }
    return report
