"""Primary /api/* dispatch (jobs, vendor, interview, resume, talent, vault)."""

from __future__ import annotations

from app.db.finders import (
    employer_app_counts_for_org,
    find_employer_app,
    find_employer_app_for,
    find_job,
    find_user,
    remove_job,
    session_items_for_email,
    vault_for_org,
)
import asyncio
import functools
import importlib.util
import logging
import os
import re
import secrets
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response

from app.db import store as db_store
from app.db.persistence import persistence_ready
from app.db.talent_index import (
    get_candidate_talent_by_id,
    grant_organization_talent_access,
    search_candidate_talent,
    upsert_candidate_talent,
)
from app.db.uow import UnitOfWork
from app.dispatch.context import DispatchContext
from app.node_config import config, is_prod_like
from app.proctoring.strip_proctoring import strip_interview_result_for_candidate
from app.server import background, runtime
from app.services.ats_composite import compute_employer_interview_composite
from app.server.json_safe import json_safe
from app.services import audit
from app.services import interview_api as ia
from app.services import retake_payments
from app.services.candidate_name import candidate_display_name
from app.services.interview_invites import (
    INVITE_JOIN_WINDOW_MINUTES,
    build_interview_invite_email,
    get_interview_invite_by_token,
    insert_interview_invite,
    invite_access_state,
    invite_join_window_end,
    invite_public_url,
    new_invite_token,
    parse_invite_context,
    send_interview_invite_email,
    validate_invite_start,
)
from app.services.interview_consent import parse_interview_consent
from app.services.interview_integrity import (
    authoritative_answers,
    invite_attempt_used,
    merge_server_integrity,
    session_is_stale,
)
from app.services.interview_review import vendor_may_view_interview_session
from app.services import interview_session_lifecycle as ivlife
from app.services.interview_jd_plan import JD_INTERVIEW_DURATION_MINUTES, JD_INTERVIEW_TURN_COUNT, is_jd_first_interview
from app.services.mail_service import send_mail, smtp_configured
from app.services.proctoring.persist_flags import persist_proctoring_flags, review_logs_to_flag_sections
from app.services.proctoring.score_penalty import apply_face_deviation_penalty_to_result, count_face_proctor_deviations
from app.services.proctoring.review_events import merge_review_events
from app.services.resume_replace import public_replace_resume_error, replace_candidate_resume
from app.services.storage import interview_artifact_storage as art_store
from app.services.storage import interview_recording_storage as rec_store
from app.services.storage.resume_storage import (
    object_storage_configured,
    parse_resume_upload_body,
    public_object_storage_error,
    resolve_resume_download_for_user,
    resolve_resume_download_from_profile,
    upload_resume_to_object_storage,
)
from app.services.storage.s3_storage import s3_storage_configured
from app.services.vendor import ai_evaluation as ai_eval
from app.services.vendor.alerts import (
    list_candidate_job_alerts,
    list_employer_application_alerts,
    mark_employer_application_alerts_read,
    queue_candidate_job_alerts,
    queue_employer_application_alert,
)
from app.services.vendor.candidate_applications import (
    JOB_DELETED_MESSAGE,
    application_timeline,
    mark_candidate_job_applications_deleted,
    record_candidate_job_application,
)
from app.services.vendor.candidate_documents import (
    assert_vendor_may_open_stored_resume,
    assert_vendor_may_view_candidate_documents,
    candidate_profile_for_documents,
    redact_talent_hits,
)
from app.services.vendor.job_role_match import apply_candidate_job_scope
from app.services.vendor.jobs import (
    attach_candidate_report_to_application,
    closed_job_response_body,
    create_job_application,
    create_vendor_job,
    delete_vendor_job,
    find_job_by_code_any_status,
    get_org_application,
    get_org_application_for_recruiter,
    get_org_job,
    get_org_job_for_recruiter,
    list_job_applications,
    list_open_jobs,
    list_org_jobs,
    parse_public_job_path,
    public_job_list_payload,
    public_job_payload,
    resolve_public_job,
    update_application_interview,
    update_vendor_job,
)
from app.services.vendor import interview_plan_cache as plan_cache
from app.services.vendor.org_candidates import list_job_candidates, list_organization_candidates
from app.services.vendor.platform_candidates import list_platform_candidates

PADDLE_SCRIPT = Path(__file__).resolve().parents[2] / "paddle_resume_parser.py"
# 2 MB file -> ~2.67 MB of base64 (+ a data: URL prefix). Checked before decoding.
MAX_PARSE_BASE64_CHARS = 2_800_000


def build_dispatch_context() -> DispatchContext:
    return DispatchContext(
        config=config,
        is_prod_like=is_prod_like,
        load_db=runtime.load_db,
        save_db=runtime.save_db,
        rate_limit=runtime.rate_limit,
        client_ip=runtime.client_ip,
    )


def _json(status: int, body: dict, *, headers: dict | None = None) -> JSONResponse:
    h = {"Cache-Control": "no-store"} if headers is None else {**headers, "Cache-Control": headers.get("Cache-Control", "no-store")}
    return JSONResponse(status_code=status, content=json_safe(body), headers=h)


def _json_etag(request: Request, body: dict, *, cache_control: str = "private, no-cache") -> Response:
    """200 with an ETag, or 304 when the browser already has this exact body (saves the transfer, not the work)."""
    import hashlib
    import json as _jsonlib

    payload = _jsonlib.dumps(json_safe(body), separators=(",", ":"), ensure_ascii=False, default=str).encode("utf-8")
    etag = 'W/"' + hashlib.sha1(payload).hexdigest()[:32] + '"'
    headers = {"Cache-Control": cache_control, "ETag": etag, "Vary": "Authorization"}
    inm = request.headers.get("if-none-match") or ""
    if etag in [t.strip() for t in inm.split(",")]:
        return Response(status_code=304, headers=headers)
    return Response(content=payload, media_type="application/json", headers=headers)


def _int_param(raw: Any, default: int, *, lo: int, hi: int) -> int:
    """Query parameters are user input: a bad number is a default, never a 500 (V-23)."""
    try:
        return max(lo, min(hi, int(str(raw).strip()))) if raw not in (None, "") else default
    except (TypeError, ValueError):
        return default


def _org_id(tenant: dict | None) -> str | None:
    org = (tenant or {}).get("organization") or {}
    return str(org.get("id")) if org.get("id") else None


def _resume_key_prefix(key) -> str:
    """The first two segments of a storage key (e.g. "users/<id>/"), safe to log: no file name."""
    parts = [p for p in str(key or "").split("/") if p]
    return "/".join(parts[:2]) + "/" if parts else ""


def _vendor_recruiter_scope(access: dict) -> dict:
    user = access["user"]
    return {"createdByUserId": user.get("id"), "createdByEmail": user.get("email")}


def _is_open_vendor_job(job: dict | None) -> bool:
    status = str((job or {}).get("status") or "published").lower()
    return status in ("active", "published")


async def _resolve_vendor_job_for_interview(db: dict, body: dict, email: str) -> dict:
    if body.get("applicationId"):
        app = find_employer_app(db, str(body["applicationId"]))
        if not app:
            return {"error": {"status": 404, "message": "Application not found."}}
        if str(app.get("candidateEmail") or "").lower() != str(email or "").lower():
            return {"error": {"status": 403, "message": "This application does not belong to your account."}}
        job = get_org_job(db, app["organizationId"], app["jobId"])
        if not job and persistence_ready(config.database_url):
            await asyncio.to_thread(db_store.sync_open_jobs_from_database, config.database_url, db)
            job = get_org_job(db, app["organizationId"], app["jobId"])
        if not job:
            return {"error": {"status": 404, "message": "Job not found for this application."}}
        return {"job": job, "application": app}
    if body.get("jobId"):
        job = find_job(db, str(body["jobId"]))
        if not job and persistence_ready(config.database_url):
            await asyncio.to_thread(db_store.sync_open_jobs_from_database, config.database_url, db)
            job = find_job(db, str(body["jobId"]))
        if not job or not _is_open_vendor_job(job):
            return {"error": {"status": 404, "message": "Job not found or not open."}}
        return {"job": job, "application": None}
    return {"job": None, "application": None}


async def _link_invite_application(db: dict, invite: dict, email: str) -> dict | None:
    """T3 #1: an open invite for a job (\"Invite by email\" / row \"Invite\") carries job_id + organization_id but no
    application. Find or create the candidate's application for that job so the interview is saved against it and the
    recruiter sees the applicant, tiles, ranking and report."""
    job_id = str(invite.get("job_id") or "")
    org_id = str(invite.get("organization_id") or "")
    if not job_id or not org_id:
        return None
    job = get_org_job(db, org_id, job_id)
    if not job and persistence_ready(config.database_url):
        await asyncio.to_thread(db_store.sync_open_jobs_from_database, config.database_url, db)
        job = get_org_job(db, org_id, job_id)
    if not job:
        return None
    existing = await asyncio.to_thread(find_employer_app_for, db, job_id, email)
    if existing:
        return existing if str(existing.get("organizationId") or "") == org_id else None
    account = await asyncio.to_thread(find_user, db, email=email)
    profile = (db.get("profiles") or {}).get(email) or {}
    try:
        pack = create_job_application(
            db,
            job,
            {
                "candidateName": candidate_display_name(
                    db,
                    email,
                    resume_text=profile.get("resumeText"),
                    given=profile.get("fullName") or invite.get("candidate_name"),
                    account_name=(account or {}).get("name"),
                ),
                "candidatePhone": profile.get("contactPhone") or (account or {}).get("phone"),
                "candidateRole": profile.get("currentRole") or "",
                "experienceYears": profile.get("totalExperience") or "",
                "resumeName": profile.get("resumeName") or "HireRighttt profile",
                "resumeText": str(profile.get("resumeText") or ""),
                "candidateEmail": email,
                "candidateUserId": (account or {}).get("id"),
                "source": "invite",
            },
        )
    except ValueError:
        return None
    application = pack["application"]
    attach_candidate_report_to_application(db, application, email, {"attachInterviewReport": False})
    if pack.get("created"):
        queue_employer_application_alert(db, job, application, True)
    candidate_application = record_candidate_job_application(db, email, job, application, {})
    if persistence_ready(config.database_url):
        import psycopg

        try:
            await asyncio.to_thread(db_store.upsert_employer_application_record, config.database_url, application)
            await asyncio.to_thread(db_store.upsert_job_application_record, config.database_url, email, candidate_application)
        except psycopg.errors.UniqueViolation:
            # A parallel start created it first: forget this in-memory copy and use the stored row.
            if isinstance(db, UnitOfWork):
                db.list("employerApplications").remove_obj(application)
            else:
                db["employerApplications"] = [a for a in db.get("employerApplications") or [] if a is not application]
            return await asyncio.to_thread(find_employer_app_for, db, job_id, email)
        if (account or {}).get("id"):
            background.spawn(
                grant_organization_talent_access(config.database_url, org_id, account["id"], "invite"),
                "grant-talent-access",
            )
    return application


def _retake_required_response() -> Response:
    return _json(
        402,
        {
            "error": f"You have used your free interview. A retake costs ₹{retake_payments.retake_price_inr()}.",
            "code": "RETAKE_PAYMENT_REQUIRED",
            "priceInr": retake_payments.retake_price_inr(),
            "paymentsConfigured": retake_payments.payments_configured(),
        },
    )


_ENDED_STATUSES = (ivlife.STATUS_EXPIRED, ivlife.STATUS_ABANDONED)


def _session_ended_response(session: dict) -> Response:
    if session.get("status") == ivlife.STATUS_ABANDONED:
        return _json(
            410,
            {
                "error": "This interview was left unfinished for too long and has ended. Please start a new interview.",
                "code": "SESSION_ABANDONED",
            },
        )
    return _json(410, {"error": "This interview session has expired. Please start a new interview.", "code": "SESSION_EXPIRED"})


async def _activate_interview_session(session: dict, session_id: str, email: str) -> Response | None:
    """pending -> active when the candidate enters the room (or gives the first answer). Only now is the free career
    interview (or a paid credit) claimed (T5 B11). Idempotent for an active session."""
    status = session.get("status")
    if status in (ivlife.STATUS_ACTIVE, "completed"):
        return None
    if status in _ENDED_STATUSES:
        return _session_ended_response(session)
    if status != ivlife.STATUS_PENDING:
        return None
    if ivlife.pending_expired(session):
        session["status"] = ivlife.STATUS_EXPIRED
        return _session_ended_response(session)
    if session.get("careerInterview") and persistence_ready(config.database_url):
        from psycopg.rows import dict_row

        def _take_slot() -> str | None:
            # Atomic: the free slot is a unique row (migration 0005) and a credit is taken FOR UPDATE SKIP LOCKED, so
            # N parallel entries get at most one free interview plus one per paid credit.
            with db_store.db_pool(config.database_url).connection() as conn:
                conn.row_factory = dict_row
                state = retake_payments.retake_status(conn, email)
                if state.get("freeInterviewAvailable") and retake_payments.claim_free_interview(conn, email, session_id):
                    conn.commit()
                    return "free"
                if retake_payments.consume_credit_for_start(conn, email, session_id):
                    conn.commit()
                    return "credit"
                conn.commit()
                return None

        taken = await asyncio.to_thread(_take_slot)
        if not taken:
            return _retake_required_response()
        session["billing"] = taken
    ivlife.mark_entered(session)
    return None


def _is_fallback_question(question: object) -> bool:
    return isinstance(question, dict) and bool(question.get("fallback"))


def _session_start_payload(session_id: str, session: dict, *, resumed: bool = False, previous: dict | None = None) -> dict:
    questions = session.get("questions") or []
    state = ivlife.resume_state(session) if resumed else None
    index = state["questionIndex"] if state else 0
    sa = session.get("skillAnalysis")
    # True only when at least one question was not filled from the deterministic fallback bank.
    llm_questions = any(not _is_fallback_question(q) for q in questions)
    payload: dict = {
        "sessionId": session_id,
        "agent": session.get("agent"),
        "adaptive": True,
        "llm": llm_questions,
        "fallbackCount": sum(1 for q in questions if _is_fallback_question(q)),
        "total": session.get("totalTurns"),
        "questionIndex": index,
        "question": questions[index] if questions else None,
        "questions": questions,
        "varietySeed": session.get("varietySeed"),
        "jdFirst": bool(session.get("jdFirst")),
        "durationMinutes": session.get("durationMinutes"),
        "profileDigest": session.get("context"),
        "questionMode": session.get("questionMode"),
        "skillAnalysis": (
            {k: sa.get(k) for k in ("jdSkills", "matchedSkills", "missingSkills", "atsScore", "jdMatchScore")}
            if isinstance(sa, dict)
            else None
        ),
        "job": session.get("jobSummary"),
        "applicationId": session.get("applicationId"),
        "status": session.get("status"),
        "resumed": bool(resumed),
    }
    if state:
        payload.update(state)
    if previous:
        payload["previousAttempt"] = previous
    return payload


def _attach_interview_session_status(db: dict, organization_id: str, payload: dict) -> dict:
    """Add interviewSessionStatus from the latest session for this organisation. Order is unchanged."""
    from app.db.finders import sessions_for_org

    latest: dict[str, tuple[str, str]] = {}
    for session in sessions_for_org(db, organization_id):
        if not isinstance(session, dict):
            continue
        email = str(session.get("email") or "").strip().lower()
        status = str(session.get("status") or "").strip()
        if not email or not status:
            continue
        stamp = max(str(session.get(key) or "") for key in ("lastActivityAt", "completedAt", "startedAt", "createdAt"))
        prev = latest.get(email)
        if prev is None or stamp > prev[0]:
            latest[email] = (stamp, status)
    candidates = []
    for row in payload.get("candidates") or []:
        if not isinstance(row, dict):
            candidates.append(row)
            continue
        found = latest.get(str(row.get("candidateEmail") or "").strip().lower())
        if found:
            candidates.append({**row, "interviewSessionStatus": found[1]})
        else:
            candidates.append(row)
    return {**payload, "candidates": candidates}


async def _candidate_booking(db: dict, email: str, user: dict | None) -> dict | None:
    """The candidate's next self-booked interview slot that has not finished (T1: the lock must not live only in
    sessionStorage). Recruiter-sent links are not slot bookings and never lock anything."""
    if not persistence_ready(config.database_url) or not (user or {}).get("id"):
        return None
    pool = db_store.db_pool(config.database_url)

    def _load() -> list[dict]:
        from psycopg.rows import dict_row

        with pool.connection() as conn:
            conn.row_factory = dict_row
            return conn.execute(
                """SELECT token, job_id, application_id, job_title, scheduled_start, scheduled_end
                     FROM interview_invites
                    WHERE lower(candidate_email) = lower(%s) AND created_by_user_id = %s AND scheduled_end > NOW()
                    ORDER BY scheduled_start ASC LIMIT 5""",
                (email, user["id"]),
            ).fetchall()

    try:
        rows = await asyncio.to_thread(_load)
    except Exception:
        logger.warning("Could not load interview bookings", exc_info=True)
        return None
    for row in rows:
        token = str(row.get("token") or "")
        if not token or invite_attempt_used(db, token):
            continue
        state = invite_access_state(row)
        if state.get("status") not in ("too_early", "open"):
            continue
        return {
            "token": token,
            "jobId": row.get("job_id"),
            "applicationId": row.get("application_id"),
            "jobTitle": row.get("job_title") or "AI Interview",
            "scheduledStart": state["scheduledStart"].isoformat().replace("+00:00", "Z"),
            "scheduledEnd": state["scheduledEnd"].isoformat().replace("+00:00", "Z"),
            "status": state["status"],
            "inviteUrl": invite_public_url(token, None),
        }
    return None


@functools.lru_cache(maxsize=1)
def paddle_ocr_available() -> bool:
    """Off unless PADDLE_OCR_ENABLED=1. When that is set, the OCR subprocess still needs the script and paddleocr.

    paddleocr is not in requirements.txt, so without this check every file parse spawned a Python process that failed
    with ModuleNotFoundError (~0.2 s each, on the event loop)."""
    enabled = os.environ.get("PADDLE_OCR_ENABLED", "").strip().lower()
    if enabled not in ("1", "true", "yes", "on"):
        return False
    if not PADDLE_SCRIPT.is_file():
        return False
    try:
        return importlib.util.find_spec("paddleocr") is not None
    except (ImportError, ValueError):
        return False


PADDLE_TIMEOUT_S = 60


def _run_paddle_sync(buffer: bytes, filename: str) -> dict | None:
    suffix = Path(filename).suffix or ".pdf"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(buffer)
        path = tmp.name
    cmd = [sys.executable, str(PADDLE_SCRIPT), path]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=PADDLE_TIMEOUT_S)
        if out.returncode != 0:
            return None
        import json

        parsed = json.loads(out.stdout.strip())
        return parsed if parsed and not parsed.get("error") else None
    except Exception:
        return None
    finally:
        Path(path).unlink(missing_ok=True)


async def _run_paddle(buffer: bytes, filename: str) -> dict | None:
    if not paddle_ocr_available():
        return None
    # The OCR subprocess can take seconds: run it in a worker thread, never on the event loop.
    return await asyncio.to_thread(_run_paddle_sync, buffer, filename)


class _ResumeUploadError(Exception):
    def __init__(self, status: int, error: str) -> None:
        self.status = status
        self.error = error


def _decode_file_data(file_data: object) -> bytes:
    if not isinstance(file_data, str) or len(file_data) > MAX_PARSE_BASE64_CHARS:
        raise _ResumeUploadError(413, "Resume files must be 2 MB or smaller.")
    import base64

    raw = file_data.split(",", 1)[1] if "," in file_data else file_data
    try:
        return base64.b64decode(raw)
    except ValueError:
        raise _ResumeUploadError(400, "The resume file could not be read.") from None


def _is_pdf_payload(buf: bytes, file_name: str) -> bool:
    if buf[:5] == b"%PDF-":
        return True
    return file_name.lower().endswith(".pdf") and b"%PDF-" in buf[:1024]


async def _read_resume_parse_parts(request: Request) -> tuple[str, str, bytes | None]:
    """Client text, filename, and raw upload bytes (JSON fileData/fileBase64 or a multipart file)."""
    content_type = (request.headers.get("content-type") or "").lower()
    if "multipart/form-data" in content_type:
        form = await request.form()
        text = str(form.get("text") or form.get("resumeText") or "").strip()[:100000]
        file_name = str(form.get("fileName") or form.get("filename") or "resume.pdf")[:200]
        upload = form.get("file") or form.get("resume")
        if upload is not None and hasattr(upload, "read"):
            data = await upload.read()
            if len(data) > 2_000_000:
                raise _ResumeUploadError(413, "Resume files must be 2 MB or smaller.")
            named = str(getattr(upload, "filename", "") or "")[:200]
            if named:
                file_name = named
            return text, file_name, data
        file_data = form.get("fileData") or form.get("fileBase64")
        if file_data:
            return text, file_name, _decode_file_data(file_data)
        return text, file_name, None

    body = await runtime.read_json_body(request)
    file_data = body.get("fileData") or body.get("fileBase64")
    file_name = str(body.get("fileName") or body.get("filename") or "resume.pdf")[:200]
    text = str(body.get("text") or body.get("resumeText") or "").strip()[:100000]
    if file_data:
        return text, file_name, _decode_file_data(file_data)
    return text, file_name, None


async def _paddle_extract(file_bytes: bytes, file_name: str) -> dict | None:
    """OCR only when PADDLE_OCR_ENABLED=1. Does not spawn a process otherwise."""
    if not paddle_ocr_available():
        return None
    return await _run_paddle(file_bytes, file_name)


async def _resume_bytes_text(buf: bytes, file_name: str) -> str:
    from app.services.resume_text import resume_file_text

    try:
        return await asyncio.to_thread(resume_file_text, buf, file_name)
    except Exception:
        return ""


async def _resume_parse_response(client_text: str, file_name: str, file_bytes: bytes | None) -> JSONResponse:
    """PDF uploads are read with pdf_layout_text even when the client also sent a text string."""
    text = client_text
    warnings: list[str] = []
    if file_bytes and _is_pdf_payload(file_bytes, file_name):
        from app.services.resume_parse.extract_pdf import pdf_layout_text

        layout = await asyncio.to_thread(pdf_layout_text, file_bytes)
        layout_text = (layout.text or "").strip()
        if layout_text:
            text = layout_text
            if layout.scanned:
                warnings.append("scanned_pdf")
        elif layout.scanned:
            # Both pdfium and pypdf returned nothing. Client text is not a substitute for a scanned file.
            ocr = await _paddle_extract(file_bytes, file_name)
            if ocr is not None:
                return _json(200, {"ok": True, "source": "paddle-ocr", "extract": ocr})
            return _json(422, {"ok": False, "error": "scanned_pdf_unreadable"})
    else:
        if file_bytes and len(text) < 40:
            ocr = await _paddle_extract(file_bytes, file_name)
            if ocr is not None:
                return _json(200, {"ok": True, "source": "paddle-ocr", "extract": ocr})
        if file_bytes and not text:
            text = await _resume_bytes_text(file_bytes, file_name)

    if text:
        parsed = await ia.parse_resume_with_ai(text)
        if parsed:
            source = str(parsed.pop("_responseSource", "") or "")
            if source not in ("llm", "rules", "cache"):
                source = "rules"
            if source == "rules":
                parsed.pop("source", None)
            body: dict[str, Any] = {"ok": True, "source": source, "extract": parsed}
            if warnings:
                body["warnings"] = warnings
            return _json(200, body)
    return _json(400, {"ok": False, "error": "Could not extract fields from resume."})


logger = logging.getLogger("hireright.api")


def _invite_reminder_info(row: dict) -> dict | None:
    from app.services.vendor.invite_status import reminder_info

    try:
        return reminder_info(row)
    except Exception:
        return None


async def handle_api_dispatch(request: Request, ctx: DispatchContext) -> Response | None:
    path = request.url.path
    method = request.method.upper()
    ip = ctx.client_ip(request)
    vault_tenant_id: str | None = None

    try:
        if path.startswith("/api/confidential/"):
            email = await runtime.require_auth_email(request)
            db = ctx.load_db()
            user = (lambda _u: _u if _u and _u.get("status") != "disabled" else None)(
                await asyncio.to_thread(find_user, db, email=email)
            )
            if not user:
                return _json(403, {"error": "Recruiter organization access required"})
            tenant = await asyncio.to_thread(runtime.tenant_context_for_user, db, user)
            if (
                user.get("role") != "employer"
                or (tenant.get("organization") or {}).get("status") != "active"
                or (tenant.get("membership") or {}).get("role") not in ("owner", "admin", "recruiter")
            ):
                return _json(403, {"error": "Recruiter organization access required"})
            vault_tenant_id = tenant["organization"]["id"]

        if method == "GET" and path == "/api/candidate/job-alerts":
            email = await runtime.require_auth_email(request)
            db = ctx.load_db()
            user = await asyncio.to_thread(find_user, db, email=email)
            if user and user.get("role") == "employer":
                return _json(403, {"error": "Candidates only."})
            return _json(200, {"alerts": await asyncio.to_thread(list_candidate_job_alerts, db, email)})

        if method == "GET" and path == "/api/jobs":
            email = await runtime.require_auth_email(request)
            db = ctx.load_db()
            params = request.query_params
            summary = params.get("summary") == "1"
            scope = "all" if params.get("scope") == "all" else "matched"
            mapper = public_job_list_payload if summary else public_job_payload
            use_slim = summary and isinstance(db, UnitOfWork) and persistence_ready(config.database_url)

            def _scoped_jobs() -> dict:
                # Blocking (database): runs in a worker thread.
                if use_slim:
                    # P-03: list columns only, description cut in SQL, shared for a few seconds per process.
                    open_jobs = [
                        j for j in db_store.open_job_summaries(config.database_url) if str(j.get("title") or "").strip()
                    ]
                else:
                    if persistence_ready(config.database_url):
                        db_store.sync_open_jobs_from_database(config.database_url, db)
                    open_jobs = list_open_jobs(db)
                return apply_candidate_job_scope(db, email, open_jobs, scope)

            scoped = await asyncio.to_thread(_scoped_jobs)
            open_jobs = scoped["jobs"]
            meta = scoped["meta"]
            limit_raw = params.get("limit")
            if limit_raw:
                safe_limit = _int_param(limit_raw, 4, lo=1, hi=50)
                safe_offset = _int_param(params.get("offset"), 0, lo=0, hi=1_000_000)
                page = open_jobs[safe_offset : safe_offset + safe_limit]
                return _json_etag(
                    request,
                    {
                        "jobs": [mapper(j) for j in page],
                        "total": len(open_jobs),
                        "limit": safe_limit,
                        "offset": safe_offset,
                        **meta,
                    },
                )
            jobs = [mapper(j) for j in open_jobs]
            return _json_etag(request, {"jobs": jobs, "total": len(jobs), **meta})

        if method == "GET" and path.startswith("/api/jobs/public/"):
            parsed = parse_public_job_path(path)
            if parsed.get("isApply") or not parsed.get("code"):
                return _json(404, {"error": "Job link not found or expired."})
            db = ctx.load_db()
            job = await resolve_public_job(db, config.database_url, parsed["code"], parsed.get("companySlug"))
            if not job:
                stale = await asyncio.to_thread(find_job_by_code_any_status, db, parsed["code"], config.database_url)
                if stale:
                    return _json(410, closed_job_response_body(stale))
                return _json(404, {"error": "Job link not found or expired."})
            return _json(200, {"job": public_job_payload(job)})

        if method == "POST" and path.startswith("/api/jobs/public/") and path.endswith("/apply"):
            parsed = parse_public_job_path(path)
            body = await runtime.read_json_body(request)
            db = ctx.load_db()
            if persistence_ready(config.database_url):
                await asyncio.to_thread(db_store.sync_open_jobs_from_database, config.database_url, db)
            job = await resolve_public_job(db, config.database_url, parsed["code"], parsed.get("companySlug"))
            if not job:
                stale = await asyncio.to_thread(find_job_by_code_any_status, db, parsed["code"], config.database_url)
                if stale:
                    return _json(410, closed_job_response_body(stale))
                return _json(404, {"error": "Job link not found or expired."})
            session_email = await runtime.require_auth_email(request)
            body_email = str(body.get("candidateEmail") or "").strip().lower()
            if body_email and body_email != session_email:
                return _json(403, {"error": "Application email must match your signed-in candidate account."})
            u = await asyncio.to_thread(find_user, db, email=session_email)
            if u and u.get("role") == "employer":
                return _json(
                    403,
                    {
                        "error": "Employer (vendor) accounts cannot apply to jobs as candidates. Sign out and use a candidate account with its own email and phone.",
                    },
                )
            resume_text = str(body.get("resumeText") or "")
            if len(resume_text.strip()) < 30 or len(resume_text) > 100000:
                return _json(400, {"error": "Upload a readable resume before applying (30–100,000 characters)."})
            ats_evaluation = await ai_eval.evaluate_resume_against_jd(
                resume_text=resume_text,
                job_description=job.get("jobDescription") or "",
                required_skills=job.get("requiredSkills") or [],
                role_title=job.get("roleTrack"),
            )
            profile = (db.get("profiles") or {}).get(session_email) or {}
            created_pack = create_job_application(
                db,
                job,
                {
                    # The name on the resume being sent (or the profile resume), never a name typed over it.
                    "candidateName": candidate_display_name(
                        db,
                        session_email,
                        resume_text=resume_text,
                        given=profile.get("fullName") or body.get("candidateName") or profile.get("name"),
                        account_name=(u or {}).get("name"),
                    ),
                    "candidatePhone": body.get("candidatePhone") or profile.get("contactPhone") or (u or {}).get("phone"),
                    "candidateRole": body.get("candidateRole") or profile.get("currentRole") or "",
                    "experienceYears": body.get("experienceYears") or profile.get("totalExperience") or "",
                    "resumeName": body.get("resumeName") or profile.get("resumeName") or "HireRighttt profile",
                    "resumeText": resume_text,
                    "candidateEmail": session_email,
                    "candidateUserId": (u or {}).get("id"),
                    "atsEvaluation": ats_evaluation,
                    "source": body.get("source"),
                },
            )
            application = created_pack["application"]
            created = created_pack["created"]
            attach_candidate_report_to_application(
                db,
                application,
                session_email,
                {
                    "candidateRole": body.get("candidateRole") or profile.get("currentRole") or "",
                    "attachInterviewReport": body.get("attachInterviewReport") is not False,
                    "interview": (db.get("interviews") or {}).get(session_email),
                },
            )
            if created:
                queue_employer_application_alert(db, job, application, True)
            candidate_application = record_candidate_job_application(
                db,
                session_email,
                job,
                application,
                {"match": body.get("match")},
            )
            if persistence_ready(config.database_url):
                import psycopg

                try:
                    await asyncio.to_thread(db_store.upsert_employer_application_record, config.database_url, application)
                except psycopg.errors.UniqueViolation:
                    # Double submit: a parallel request from this candidate created the application first (unique
                    # job_id + candidate_email). Nothing from this request is saved; answer with the existing one.
                    def _existing_id() -> str | None:
                        with db_store.db_pool(config.database_url).connection() as conn:
                            row = conn.execute(
                                "SELECT id FROM employer_applications WHERE job_id = %s AND lower(candidate_email) = %s",
                                (job["id"], session_email),
                            ).fetchone()
                        return (row or {}).get("id") if isinstance(row, dict) else (row[0] if row else None)

                    existing_id = await asyncio.to_thread(_existing_id)
                    return _json(
                        200,
                        {
                            "applicationId": existing_id,
                            "alreadyApplied": True,
                            "job": public_job_payload(job),
                            "organizationId": job["organizationId"],
                        },
                    )
                await asyncio.to_thread(
                    db_store.upsert_job_application_record, config.database_url, session_email, candidate_application
                )
            await ctx.save_db(db)
            if (u or {}).get("id") and persistence_ready(config.database_url):
                background.spawn(
                    grant_organization_talent_access(config.database_url, job["organizationId"], u["id"], "application"),
                    "grant-talent-access",
                )
            ats = created_pack.get("ats") or {
                "atsScore": application["data"].get("atsScore"),
                "jdMatchScore": application["data"].get("jdMatchScore"),
                "primarySkills": application["data"].get("primarySkills"),
                "matchedSkills": application["data"].get("matchedSkills"),
                "missingSkills": application["data"].get("missingSkills"),
                "strengths": application["data"].get("atsStrengths"),
                "gaps": application["data"].get("atsGaps"),
                "summary": application["data"].get("atsSummary"),
                "aiEnhanced": application["data"].get("aiEnhancedAts"),
            }
            return _json(
                201 if created else 200,
                {
                    "applicationId": application["id"],
                    "candidateApplication": candidate_application,
                    "job": public_job_payload(job),
                    "ats": ats,
                    "organizationId": job["organizationId"],
                },
            )

        if method == "POST" and path == "/api/vendor/jobs":
            db = ctx.load_db()
            access = await runtime.require_employer_tenant(request, db)
            body = await runtime.read_json_body(request)
            job: dict | None = None
            try:
                job = create_vendor_job(db, access["tenant"]["organization"]["id"], access["user"]["id"], body)
                match_alert_emails = queue_candidate_job_alerts(db, job)
                await ctx.save_db(db)
                if persistence_ready(config.database_url):
                    await asyncio.to_thread(db_store.upsert_job_record, config.database_url, job)
                    try:
                        await asyncio.to_thread(db_store.sync_open_jobs_from_database, config.database_url, db)
                    except Exception:
                        pass
                return _json(201, {"job": public_job_payload(job), "matchAlertsQueued": len(match_alert_emails)})
            except ValueError as err:
                if job and job.get("id"):
                    remove_job(db, job["id"])
                return _json(getattr(err, "status", 400), {"error": str(err)})
            except Exception:
                if job and job.get("id"):
                    remove_job(db, job["id"])
                raise

        if method == "GET" and path == "/api/vendor/jobs":
            db = ctx.load_db()
            access = await runtime.require_employer_tenant(request, db)
            org_id = access["tenant"]["organization"]["id"]
            if persistence_ready(config.database_url):
                await asyncio.to_thread(db_store.sync_org_jobs_from_database, config.database_url, db, org_id)
            scope = _vendor_recruiter_scope(access)
            # Applicant counts in one grouped query, so the jobs page no longer fetches every job's applicant list.
            counts = employer_app_counts_for_org(db, org_id)
            jobs = [
                {**public_job_payload(j), "applicantCount": counts.get(str(j.get("id")), 0)}
                for j in list_org_jobs(db, org_id, scope)
            ]
            return _json(200, {"jobs": jobs, "total": len(jobs), "organizationId": org_id})

        if method == "POST" and re.match(r"^/api/vendor/jobs/[^/]+/mark-deleted-for-candidates$", path):
            db = ctx.load_db()
            access = await runtime.require_employer_tenant(request, db)
            job_id = path.split("/")[4]
            org_id = access["tenant"]["organization"]["id"]
            scope = _vendor_recruiter_scope(access)
            job = get_org_job_for_recruiter(db, org_id, job_id, scope)
            if not job:
                return _json(404, {"error": "Job not found."})
            marked = mark_candidate_job_applications_deleted(db, job_id, {"title": job.get("title"), "company": job.get("company")})
            if persistence_ready(config.database_url):
                await asyncio.to_thread(
                    db_store.mark_job_applications_deleted_in_postgres,
                    config.database_url,
                    job_id,
                    {"jobDeletedMessage": JOB_DELETED_MESSAGE},
                )
                for row in marked["records"]:
                    await asyncio.to_thread(
                        db_store.upsert_job_application_record, config.database_url, row["email"], row["record"]
                    )
            await ctx.save_db(db)
            return _json(200, {"ok": True, "jobId": job_id, "candidateApplicationsUpdated": marked["updated"]})

        if method == "PATCH" and re.match(r"^/api/vendor/jobs/[^/]+$", path):
            # Edit a job and / or move it through its lifecycle (draft / published / closed / archived).
            # Owner and admin may change any job of their organisation; a recruiter only the jobs they created.
            # Another organisation's job is a 404 (never reveal that it exists); a non-recruiter member is a 403.
            db = ctx.load_db()
            access = await runtime.require_employer_tenant(request, db)
            body = await runtime.read_json_body(request)
            job_id = path.split("/")[4]
            org_id = access["tenant"]["organization"]["id"]
            member_role = (access["tenant"].get("membership") or {}).get("role")
            if persistence_ready(config.database_url):
                await asyncio.to_thread(db_store.sync_org_jobs_from_database, config.database_url, db, org_id)
            job = (
                get_org_job(db, org_id, job_id)
                if member_role in ("owner", "admin")
                else get_org_job_for_recruiter(db, org_id, job_id, _vendor_recruiter_scope(access))
            )
            if not job:
                return _json(404, {"error": "Job not found."})
            before = {k: job.get(k) for k in ("title", "status")}
            try:
                outcome = update_vendor_job(job, body)
            except ValueError as err:
                return _json(getattr(err, "status", 400), {"error": str(err)})
            if outcome["changed"]:
                await ctx.save_db(db)
                if persistence_ready(config.database_url):
                    await asyncio.to_thread(db_store.upsert_job_record, config.database_url, job)
                audit.fire(
                    audit.JOB_UPDATED,
                    user_id=access["user"].get("id"),
                    organization_id=org_id,
                    entity_type="job",
                    entity_id=job_id,
                    meta={
                        "fields": outcome["changed"],
                        "statusFrom": outcome["from"],
                        "statusTo": outcome["to"],
                        "titleBefore": before["title"] if "title" in outcome["changed"] else None,
                    },
                )
            counts = employer_app_counts_for_org(db, org_id)
            return _json(
                200,
                {
                    "job": {**public_job_payload(job), "applicantCount": counts.get(str(job_id), 0)},
                    "changed": outcome["changed"],
                },
            )

        if method == "DELETE" and re.match(r"^/api/vendor/jobs/[^/]+$", path):
            db = ctx.load_db()
            access = await runtime.require_employer_tenant(request, db)
            job_id = path.split("/")[4]
            org_id = access["tenant"]["organization"]["id"]
            scope = _vendor_recruiter_scope(access)
            try:
                job = get_org_job_for_recruiter(db, org_id, job_id, scope)
                marked = (
                    mark_candidate_job_applications_deleted(db, job_id, {"title": job.get("title"), "company": job.get("company")})
                    if job
                    else {"updated": 0, "records": []}
                )
                removed = delete_vendor_job(db, org_id, job_id)
                if persistence_ready(config.database_url):
                    if marked["updated"] > 0:
                        await asyncio.to_thread(
                            db_store.mark_job_applications_deleted_in_postgres,
                            config.database_url,
                            job_id,
                            {"jobDeletedMessage": JOB_DELETED_MESSAGE},
                        )
                        for row in marked["records"]:
                            await asyncio.to_thread(
                                db_store.upsert_job_application_record, config.database_url, row["email"], row["record"]
                            )
                    await asyncio.to_thread(db_store.delete_job_record, config.database_url, job_id, org_id)
                await ctx.save_db(db)
                return _json(
                    200,
                    {"ok": True, **removed, "candidateApplicationsUpdated": marked["updated"]},
                )
            except ValueError as err:
                return _json(getattr(err, "status", 500), {"error": str(err)})

        if method == "GET" and path == "/api/vendor/application-alerts":
            db = ctx.load_db()
            access = await runtime.require_employer_tenant(request, db)
            org_id = access["tenant"]["organization"]["id"]
            alerts = list_employer_application_alerts(db, org_id, {"unreadOnly": True, **_vendor_recruiter_scope(access)})
            return _json(200, {"alerts": alerts, "total": len(alerts)})

        if method == "POST" and path == "/api/vendor/application-alerts/read":
            db = ctx.load_db()
            access = await runtime.require_employer_tenant(request, db)
            body = await runtime.read_json_body(request)
            org_id = access["tenant"]["organization"]["id"]
            ids = [str(x) for x in body.get("ids") or []] if isinstance(body.get("ids"), list) else None
            mark_employer_application_alerts_read(db, org_id, ids)
            await ctx.save_db(db)
            return _json(200, {"ok": True})

        if method == "GET" and path.startswith("/api/vendor/jobs/") and path.endswith("/applicants"):
            db = ctx.load_db()
            access = await runtime.require_employer_tenant(request, db)
            if persistence_ready(config.database_url):
                await asyncio.to_thread(db_store.sync_employer_applications_from_database, config.database_url, db)
            job_id = path.split("/")[4]
            scope = _vendor_recruiter_scope(access)
            job = get_org_job_for_recruiter(db, access["tenant"]["organization"]["id"], job_id, scope)
            if not job:
                return _json(404, {"error": "Job not found."})
            from app.services.vendor.applicant_ranking import rank_job_applicants

            from app.db.finders import interviews_for_emails, profiles_for_emails

            def _ranked() -> list[dict]:
                # Blocking (database): a worker thread. Profiles and stored interviews for every applicant are
                # loaded in two queries instead of two round trips per applicant (QA: 25 applicants ~107 ms p50).
                apps = list_job_applications(db, access["tenant"]["organization"]["id"], job_id)
                emails = [str(a.get("candidateEmail") or "").strip().lower() for a in apps]
                profiles_for_emails(db, emails)
                interviews_for_emails(db, emails)
                # Best candidates first (interview score, then Role Skills Fit, then who finished first), numbered.
                return rank_job_applicants(
                    [
                        attach_candidate_report_to_application(db, app, app.get("candidateEmail"), {"attachInterviewReport": True})
                        for app in apps
                    ]
                )

            applicants = await asyncio.to_thread(_ranked)
            return _json(200, {"job": job, "applicants": applicants, "total": len(applicants)})

        if method == "GET" and path == "/api/vendor/candidates":
            db = ctx.load_db()
            access = await runtime.require_employer_tenant(request, db)
            if persistence_ready(config.database_url):
                await asyncio.to_thread(db_store.sync_employer_applications_from_database, config.database_url, db)
            org_id = access["tenant"]["organization"]["id"]
            params = request.query_params
            if str(params.get("scope") or "").strip().lower() == "platform":
                # The Candidates page: every job seeker visible to employers, one row per person, paginated here.
                if not ctx.rate_limit(f"platform-candidates:{org_id}", 600, 3_600_000):
                    return _json(429, {"error": "Too many searches. Please wait a few minutes and try again."})
                page = await list_platform_candidates(
                    db, org_id, config.database_url, dict(params), _vendor_recruiter_scope(access)
                )
                page = _attach_interview_session_status(db, org_id, page)
                return _json(200, {"organizationId": org_id, **page})
            filters = {
                "name": params.get("name") or "",
                "job": params.get("job") or "",
                "experienceYears": params.get("experienceYears") or params.get("experience") or "",
                "keywords": params.get("keywords") or params.get("q") or "",
                "jobId": params.get("jobId") or "",
                # "org" = only this organisation's own candidates (no platform roster / talent search);
                # anything else keeps the full list.
                "scope": "org" if str(params.get("scope") or "").strip().lower() == "org" else "all",
            }
            roster = await list_organization_candidates(
                db, org_id, config.database_url, filters, _vendor_recruiter_scope(access)
            )
            roster = _attach_interview_session_status(db, org_id, roster)
            return _json(200, {"organizationId": org_id, **roster})

        if method == "GET" and path == "/api/vendor/candidate-documents/resume":
            db = ctx.load_db()
            access = await runtime.require_employer_tenant(request, db)
            candidate_email = str(request.query_params.get("email") or "").strip()
            candidate_user_id = str(request.query_params.get("userId") or "").strip()
            try:
                org_id = access["tenant"]["organization"]["id"]
                scope = _vendor_recruiter_scope(access)
                if candidate_user_id:
                    # Candidates page: the original S3 file for a person already listed there.
                    owner = await asyncio.to_thread(
                        assert_vendor_may_open_stored_resume, db, org_id, candidate_user_id, scope
                    )
                    candidate_email = str(owner.get("email") or "").strip().lower()
                    owner_user_id = owner.get("id")
                else:
                    # Same rule as every candidate document: employer-visible candidates, or a link to this org.
                    await asyncio.to_thread(
                        assert_vendor_may_view_candidate_documents,
                        db,
                        org_id,
                        candidate_email,
                        scope,
                        contact=True,
                    )
                    owner_user_id = None
                profile = await asyncio.to_thread(candidate_profile_for_documents, db, candidate_email)
                candidate_account = await asyncio.to_thread(find_user, db, email=candidate_email)
                if owner_user_id is None:
                    owner_user_id = (candidate_account or {}).get("id")
                # Presign does not query Postgres. With no DATABASE_URL (in-memory tests) there is no pool to open.
                pool = db_store.db_pool(config.database_url) if (config.database_url or "").strip() else None
                signed = await resolve_resume_download_from_profile(
                    profile,
                    pool,
                    inline=True,
                    owner_user_id=owner_user_id,
                    owner_email=candidate_email.lower(),
                )
                from urllib.parse import quote

                from app.services.storage.resume_storage import infer_resume_content_type

                filename = str(signed.get("filename") or "resume")
                content_type = infer_resume_content_type(filename, str(signed.get("contentType") or "") or None)
                lower_name = filename.lower()
                if content_type == "application/pdf" and not lower_name.endswith(".pdf"):
                    stem = re.sub(r"\.(docx?|txt)$", "", filename, flags=re.I).strip() or "resume"
                    filename = stem + ".pdf"
                elif (
                    content_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    and not lower_name.endswith(".docx")
                ):
                    stem = re.sub(r"\.(pdf|doc|txt)$", "", filename, flags=re.I).strip() or "resume"
                    filename = stem + ".docx"
                elif content_type == "application/msword" and not lower_name.endswith(".doc"):
                    stem = re.sub(r"\.(pdf|docx|txt)$", "", filename, flags=re.I).strip() or "resume"
                    filename = stem + ".doc"
                if request.query_params.get("raw") == "1":
                    # The file itself, for the in-app DOCX viewer: the browser cannot read S3 cross-origin.
                    import httpx

                    key_prefix = _resume_key_prefix(profile.get("resumeStoragePath"))
                    try:
                        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0), follow_redirects=False) as http:
                            stored = await http.get(signed["url"])
                    except httpx.HTTPError as err:
                        logger.warning("Resume fetch from storage failed (%s) key_prefix=%s", type(err).__name__, key_prefix)
                        return _json(502, {"error": "Resume file could not be loaded. Please try again."})
                    if stored.status_code != 200:
                        # Never pass the raw S3 status / body to the browser; log it with the key prefix only.
                        logger.warning(
                            "Resume fetch from storage failed status=%s key_prefix=%s", stored.status_code, key_prefix
                        )
                        return _json(502, {"error": "Resume file could not be loaded. Please try again."})
                    if len(stored.content) > 10 * 1024 * 1024:
                        return _json(413, {"error": "This resume is too large to preview. Download it instead."})
                    ascii_name = filename.encode("ascii", "ignore").decode().strip() or "resume"
                    if content_type == "application/pdf" and not ascii_name.lower().endswith(".pdf"):
                        ascii_name = f"{ascii_name}.pdf"
                    elif content_type.endswith("wordprocessingml.document") and not ascii_name.lower().endswith(".docx"):
                        ascii_name = f"{ascii_name}.docx"
                    elif content_type == "application/msword" and not ascii_name.lower().endswith(".doc"):
                        ascii_name = f"{ascii_name}.doc"
                    return Response(
                        content=stored.content,
                        media_type=content_type,
                        headers={
                            "Cache-Control": "private, no-store",
                            "X-Content-Type-Options": "nosniff",
                            "Content-Disposition": (
                                f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(filename)}'
                            ),
                        },
                    )
                return _json(
                    200,
                    {
                        "viewUrl": signed["url"],
                        "downloadUrl": signed["url"],
                        "expiresInSeconds": signed.get("expiresInSeconds"),
                        "contentType": content_type,
                        "filename": filename,
                    },
                )
            except ValueError as err:
                return _json(getattr(err, "status", 500), {"error": str(err)})
            except HTTPException:
                raise
            except Exception as err:  # storage / presign failure: logged, never shown raw
                logger.warning("Resume presign failed (%s) for an employer request", type(err).__name__)
                return _json(502, {"error": "Resume file could not be loaded. Please try again."})

        if method == "GET" and re.match(r"^/api/vendor/jobs/[^/]+/candidates$", path):
            db = ctx.load_db()
            access = await runtime.require_employer_tenant(request, db)
            if persistence_ready(config.database_url):
                await asyncio.to_thread(db_store.sync_employer_applications_from_database, config.database_url, db)
            job_id = path.split("/")[4]
            scope = _vendor_recruiter_scope(access)
            job = get_org_job_for_recruiter(db, access["tenant"]["organization"]["id"], job_id, scope)
            if not job:
                return _json(404, {"error": "Job not found."})
            params = request.query_params
            filters = {
                "name": params.get("name") or "",
                "job": params.get("job") or "",
                "experienceYears": params.get("experienceYears") or params.get("experience") or "",
                "keywords": params.get("keywords") or params.get("q") or "",
            }
            roster = list_job_candidates(db, access["tenant"]["organization"]["id"], job_id, filters)
            return _json(200, {"job": job, "organizationId": access["tenant"]["organization"]["id"], **roster})

        if method == "GET" and path.startswith("/api/vendor/applicants/") and path.endswith("/report"):
            db = ctx.load_db()
            access = await runtime.require_employer_tenant(request, db)
            app_id = path.split("/")[4]
            scope = _vendor_recruiter_scope(access)
            app = get_org_application_for_recruiter(db, access["tenant"]["organization"]["id"], app_id, scope)
            if not app:
                return _json(404, {"error": "Applicant not found."})
            job = get_org_job_for_recruiter(db, access["tenant"]["organization"]["id"], app["jobId"], scope)
            force = request.query_params.get("refresh") == "1"
            if not ai_eval.vendor_report_needs_refresh(app.get("data"), force) and app.get("data", {}).get("vendorReport"):
                return _json(200, {"report": app["data"]["vendorReport"], "application": app})
            report = await ai_eval.generate_vendor_assessment_sheet(
                candidateName=candidate_display_name(
                    db,
                    app.get("candidateEmail"),
                    resume_text=app["data"].get("resumeText"),
                    given=app["data"].get("candidateName"),
                ),
                jobTitle=(job or {}).get("title") or app["data"].get("jobTitle"),
                company=(job or {}).get("company") or app["data"].get("company"),
                jobDescription=(job or {}).get("jobDescription") or "",
                resumeText=app["data"].get("resumeText") or "",
                atsEvaluation={
                    "atsScore": app["data"].get("atsScore"),
                    "jdMatchScore": app["data"].get("jdMatchScore"),
                    "primarySkills": app["data"].get("primarySkills"),
                    "matchedSkills": app["data"].get("matchedSkills"),
                    "missingSkills": app["data"].get("missingSkills"),
                    "strengths": app["data"].get("atsStrengths"),
                    "gaps": app["data"].get("atsGaps"),
                    "summary": app["data"].get("atsSummary"),
                },
                interviewResult=app["data"].get("interviewResult"),
            )
            app["data"]["vendorReport"] = report
            await ctx.save_db(db)
            return _json(200, {"report": report, "application": app})

        if method == "GET" and re.match(r"^/api/vendor/applicants/[^/]+/interview-plan$", path):
            db = ctx.load_db()
            access = await runtime.require_employer_tenant(request, db)
            app_id = path.split("/")[4]
            plan_org = access["tenant"]["organization"]["id"]
            # V-15: every uncached preview is a Gemini call on the shared key; cap it per organization.
            want_refresh = request.query_params.get("refresh") == "1"
            if want_refresh and not ctx.rate_limit(f"ivplan-refresh:{plan_org}:{app_id}", 1, 5 * 60_000):
                want_refresh = False  # one forced rebuild per application every 5 minutes; otherwise serve the cache
            if not ctx.rate_limit(f"ivplan:{plan_org}", 40, 3_600_000):
                return _json(429, {"error": "Too many interview previews this hour. Try again later."})
            scope = _vendor_recruiter_scope(access)
            app = get_org_application_for_recruiter(db, access["tenant"]["organization"]["id"], app_id, scope)
            if not app:
                return _json(404, {"error": "Applicant not found."})
            job = get_org_job_for_recruiter(db, access["tenant"]["organization"]["id"], app["jobId"], scope)
            jd = str((job or {}).get("jobDescription") or "")
            required = (job or {}).get("requiredSkills") or app.get("data", {}).get("primarySkills") or []
            applicant = app.get("data") or {}
            profile = {
                "resumeText": applicant.get("resumeText") or "",
                "workExperiences": applicant.get("workExperiences") or [],
                "skills": applicant.get("skills") or [],
                "experienceYears": applicant.get("experienceYears") or "",
                "currentRole": applicant.get("currentRole") or "",
                "achievements": applicant.get("achievements") or [],
                "metrics": applicant.get("metrics") or [],
                "education": applicant.get("education") or [],
            }
            digest = ia.summarize_profile(profile, app.get("data", {}).get("candidateName") or app.get("candidateEmail"))
            skill_analysis = ia.analyze_interview_skill_match(
                job_description=jd, required_skills=required, profile=profile, ctx=digest
            )
            role = (job or {}).get("roleTrack") or (job or {}).get("title") or app.get("data", {}).get("jobTitle") or "Engineer"
            level = app.get("data", {}).get("experienceYears") or (job or {}).get("experienceLevel") or "1–3 years"
            if not ia.llm_configured():
                return _json(
                    503,
                    {
                        "error": "Interview preview requires GEMINI_API_KEY on the server.",
                        "code": "LLM_QUESTION_REQUIRED",
                    },
                )
            try:
                skill_focus = ia.vendor_skill_focus(skill_analysis, required) if skill_analysis else []
                total_turns = ia.resolve_interview_total_turns(profile, level, digest)
                fresher = ia._is_fresher(profile, level, digest)
                # The preview matches what the candidate will get: the JD-first mix for a job with a JD.
                preview_jd_first = is_jd_first_interview(question_mode="vendor_jd", job_description=jd)
                if preview_jd_first:
                    total_turns = JD_INTERVIEW_TURN_COUNT
            except Exception as err:
                logger.warning("Interview plan preview failed for application %s: %s", app_id, err)
                return _json(503, {"error": "Could not prepare the interview preview right now. Please try again.", "code": "LLM_QUESTION_FAILED"})
            # Same applicant + same job text + same resume => same preview for 30 minutes (?refresh=1 rebuilds it).
            # Any edit to the job or the resume changes the key, so a stale plan is never served.
            plan_key = plan_cache.plan_cache_key(
                organizationId=access["tenant"]["organization"]["id"],
                applicationId=app_id,
                jobId=(job or {}).get("id"),
                jobUpdatedAt=(job or {}).get("updatedAt"),
                jobDescription=jd,
                requiredSkills=required,
                role=role,
                level=level,
                profile=profile,
                candidateName=app.get("data", {}).get("candidateName") or app.get("candidateEmail"),
                skillFocus=skill_focus,
                totalTurns=total_turns,
                fresher=fresher,
            )

            from app.services.interview_question_model import classify_question_model

            preview_model = classify_question_model(profile)

            async def _build_plan() -> dict:
                # One Gemini call with the same structure the candidate will get (it used to be 8 sequential calls,
                # 12-35 s, which could outlast the page's wait).
                batch = await ia.generate_adaptive_question_batch(
                    {
                        "ctx": digest,
                        "profile": profile,
                        "role": role,
                        "level": level,
                        "jobDescription": jd,
                        "varietySeed": secrets.token_hex(8),
                        "totalTurns": total_turns,
                        "fresher": fresher,
                        "skillFocus": skill_focus,
                        "jdFirst": preview_jd_first,
                        "jdSkills": (skill_analysis or {}).get("jdSkills") or required,
                        "questionModel": preview_model["questionModel"],
                    }
                )
                questions = []
                for q in batch.get("questions") or []:
                    if q.get("focus") == "pending-fallback" or not str(q.get("text") or "").strip():
                        q = {**q, "text": "Live follow-up on the candidate's previous answer (written during the interview).",
                             "category": q.get("category") or "Experience", "topic": q.get("topic") or "Follow-up"}
                    questions.append(q)
                return {
                    "questionMode": "adaptive",
                    "role": role,
                    "level": level,
                    "skillAnalysis": skill_analysis,
                    "questions": [
                        {"text": q["text"], "category": q.get("category"), "topic": q.get("topic"), "planSlot": q.get("planSlot")}
                        for q in questions
                    ],
                    "jdFirst": bool(batch.get("jdFirst")),
                    "durationMinutes": batch.get("durationMinutes"),
                }

            try:
                payload, _cached = await plan_cache.get_or_build(plan_key, _build_plan, refresh=want_refresh)
            except Exception as err:
                logger.warning("Interview plan preview failed for application %s: %s", app_id, err)
                return _json(503, {"error": "Could not prepare the interview preview right now. Please try again.", "code": "LLM_QUESTION_FAILED"})
            return _json(200, payload)

        if method == "POST" and path == "/api/interview/start":
            email = await runtime.require_auth_email(request)
            if not ctx.rate_limit(f"ivstart:{email}", 12):
                return _json(429, {"error": "Interview start rate limited. Wait a minute."})
            body = await runtime.read_json_body(request)
            consent_record = parse_interview_consent(body.get("consent"), runtime.client_ip(request))
            if not consent_record:
                return _json(
                    400,
                    {
                        "error": "Please agree to the recording, face tracking and AI scoring notice before starting.",
                        "code": "CONSENT_REQUIRED",
                    },
                )
            invite_token = ""
            if body.get("inviteToken") and persistence_ready(config.database_url):
                pool = db_store.db_pool(config.database_url)
                invite = await get_interview_invite_by_token(pool, str(body["inviteToken"]))
                access = validate_invite_start(invite, email)
                if not access.get("ok"):
                    return _json(access["status"], {"error": access["error"], "code": "INVITE_ACCESS_DENIED"})
                invite_token = str(body["inviteToken"])
                if invite_attempt_used(ctx.load_db(), invite_token):
                    return _json(
                        409,
                        {
                            "error": "You have already completed the interview for this invitation.",
                            "code": "INVITE_ALREADY_USED",
                        },
                    )
            db = ctx.load_db()
            if invite_token:
                # The invite knows which job / application it is for: it wins over whatever job the browser still had
                # stored (new tab, cleared storage, a different job's leftovers). An open job invite has no
                # application yet: find or create it (T3 #1) so the recruiter sees this interview.
                linked_app_id = invite.get("application_id") if invite else None
                if not linked_app_id and invite and invite.get("job_id"):
                    linked = await _link_invite_application(db, invite, email)
                    linked_app_id = (linked or {}).get("id")
                if linked_app_id:
                    body["applicationId"] = linked_app_id
                    body.pop("jobId", None)
            profile = await asyncio.to_thread(runtime.merge_interview_profile, db, email, body.get("profile"))
            from app.services.interview_question_model import career_role_label, classify_question_model

            qmodel = classify_question_model(profile if isinstance(profile, dict) else {})
            account = await asyncio.to_thread(find_user, db, email=email)
            digest = ia.summarize_profile(profile, account.get("name") if account else None)
            vendor_resolved = await _resolve_vendor_job_for_interview(db, body, email)
            if vendor_resolved.get("error"):
                err = vendor_resolved["error"]
                return _json(err["status"], {"error": err["message"]})
            # Paid retakes: the first career interview is free, later ones need a paid credit. Job interviews are free,
            # but only when the SERVER resolved the link: an application owned by this candidate or a valid invite.
            # A bare jobId (every open job id is public) made any interview free (V-06). For a jobId-only start the
            # candidate's own application to that job, if any, is used.
            if vendor_resolved.get("job") and not vendor_resolved.get("application") and not invite_token:
                own_app = await asyncio.to_thread(find_employer_app_for, db, vendor_resolved["job"].get("id"), email)
                if own_app:
                    vendor_resolved["application"] = own_app
            is_job = retake_payments.verified_job_interview(
                application=vendor_resolved.get("application"), invite_token=invite_token or None
            )
            # One prepared / resumable session per candidate + context (T5 B9/B12): a reload, a second waiting-room
            # load or a new tab gets the SAME session and questions back, without another question-generation call.
            context_key = ivlife.interview_context_key(
                email=email,
                invite_token=invite_token or None,
                application_id=str(vendor_resolved["application"]["id"]) if vendor_resolved.get("application") else None,
                job_id=str(vendor_resolved["job"]["id"]) if vendor_resolved.get("job") else None,
                role=str(body.get("role") or ""),
                level=str(body.get("level") or ""),
                job_description=str(body.get("jobDescription") or ""),
            )
            own_sessions = await asyncio.to_thread(session_items_for_email, db, email)
            swept = ivlife.sweep_candidate_sessions(own_sessions)
            reusable = ivlife.find_reusable_session(own_sessions, context_key)
            if reusable and str(reusable[1].get("questionModel") or "") != qmodel["questionModel"]:
                reusable = None
            if reusable:
                reuse_id, reuse_session = reusable
                resumed = reuse_session.get("status") == ivlife.STATUS_ACTIVE
                if resumed:
                    idx = ivlife.resume_state(reuse_session)["questionIndex"]
                    if ivlife.question_needs_generation(reuse_session, idx):
                        try:
                            nxt = await ia.generate_adaptive_question(
                                {
                                    "ctx": reuse_session.get("context") or digest,
                                    "profile": profile,
                                    "role": reuse_session.get("role"),
                                    "level": reuse_session.get("level"),
                                    "jobDescription": reuse_session.get("jobDescription") or "",
                                    "history": reuse_session.get("history") or [],
                                    "lastAnswer": str(((reuse_session.get("history") or [{}])[-1] or {}).get("answer") or ""),
                                    "accountName": account.get("name") if account else None,
                                    "varietySeed": str(reuse_session.get("varietySeed") or ""),
                                    "totalTurns": reuse_session.get("totalTurns") or ia.INTERVIEW_TURN_COUNT,
                                    "questionModel": reuse_session.get("questionModel"),
                                }
                            )
                        except Exception as err:
                            from app.services.interview_llm_questions import InterviewLlmQuestionError

                            if isinstance(err, InterviewLlmQuestionError):
                                return _json(err.status, {"error": str(err), "code": err.code})
                            raise
                        updated = list(reuse_session.get("questions") or [])
                        while len(updated) <= idx:
                            updated.append({"text": "", "focus": "pending"})
                        updated[idx] = nxt
                        reuse_session["questions"] = updated
                    reuse_session["lastActivityAt"] = ivlife.now_iso()
                db.setdefault("interviewSessions", {})[reuse_id] = reuse_session
                await ctx.save_db(db)
                return _json(200, _session_start_payload(reuse_id, reuse_session, resumed=resumed))
            previous_attempt = ivlife.previous_attempt_notice(
                next((s for s in reversed(swept) if s.get("contextKey") == context_key), None)
                or ivlife.last_abandoned(own_sessions, context_key)
            )
            if swept:
                await ctx.save_db(db)
            # A booked slot locks the career interview until the slot opens, in every tab (T1: the lock lived only in
            # sessionStorage, so a new tab bypassed it).
            if not invite_token and not vendor_resolved.get("application"):
                booking = await _candidate_booking(db, email, account)
                if booking and booking["status"] == "too_early" and (
                    not booking.get("jobId") or str(booking["jobId"]) == str((vendor_resolved.get("job") or {}).get("id") or "")
                ):
                    return _json(
                        409,
                        {
                            "error": "Your interview is booked. It opens at your scheduled time.",
                            "code": "INTERVIEW_BOOKED",
                            "booking": booking,
                            "serverNow": ivlife.now_iso(),
                        },
                    )
            retake_charged = False
            free_claim = False
            payments_db = persistence_ready(config.database_url)
            if not is_job and payments_db:
                from psycopg.rows import dict_row

                def _retake_status() -> dict:
                    with db_store.db_pool(config.database_url).connection() as conn:
                        conn.row_factory = dict_row
                        return retake_payments.retake_status(conn, email)

                status = await asyncio.to_thread(_retake_status)
                if not status["canStartCareerInterview"]:
                    return _json(
                        402,
                        {
                            "error": f"You have used your free interview. A retake costs ₹{status['priceInr']}.",
                            "code": "RETAKE_PAYMENT_REQUIRED",
                            "priceInr": status["priceInr"],
                            "paymentsConfigured": status["paymentsConfigured"],
                        },
                    )
                retake_charged = not status["freeInterviewAvailable"]
                free_claim = not retake_charged
            vendor_job = vendor_resolved.get("job")
            vendor_application = vendor_resolved.get("application")
            role = str(body.get("role") or "Full Stack Engineer")
            level = str(body.get("level") or "1–3 years")
            job_description = str(body.get("jobDescription") or "")
            explicit_role_track = body.get("explicitRoleTrack") is True
            question_mode_hint = str(body.get("questionMode") or "").strip()
            job_record = find_job(db, str(body.get("jobId") or "")) if body.get("jobId") else None
            required_skills = (
                [str(s) for s in body.get("primarySkills") or []]
                if body.get("primarySkills")
                else (job_record or {}).get("requiredSkills") or []
            )
            effective_jd = job_description or (job_record or {}).get("jobDescription") or ""
            jd_plan = None
            role_track = (job_record or {}).get("roleTrack") or role
            if vendor_job:
                role = str(vendor_job.get("title") or role)
                level = str(vendor_job.get("experienceLevel") or level)
                effective_jd = str(vendor_job.get("jobDescription") or "")
                role_track = str(vendor_job.get("roleTrack") or role)
                job_record = vendor_job
                from app.services.vendor.ats_score import extract_primary_skills_from_jd

                required_skills = vendor_job.get("requiredSkills") or extract_primary_skills_from_jd(effective_jd, [])
                question_mode = "vendor_jd"
                jd_plan = ia.build_jd_coverage_plan(jobDescription=effective_jd, requiredSkills=required_skills, resumeText=digest.get("resumeSnippet") or "")
            else:
                effective_jd_early = effective_jd
                question_mode = ia.resolve_interview_question_mode(
                    {
                        "mode": question_mode_hint
                        or ("individual_jd" if explicit_role_track and len(effective_jd_early.strip()) >= 40 else None),
                        "applicationId": body.get("applicationId"),
                        "jobId": body.get("jobId"),
                        "jobDescription": effective_jd_early,
                        "requiredSkills": required_skills,
                    }
                )
            skill_analysis = None
            if question_mode in ("employer", "individual_jd", "vendor_jd"):
                skill_analysis = ia.analyze_interview_skill_match(
                    job_description=effective_jd, required_skills=required_skills, profile=profile, ctx=digest
                )
            variety_seed = secrets.token_hex(8)
            fresher = ia._is_fresher(profile, level, digest)
            interview_total_turns = ia.resolve_interview_total_turns(profile, level, digest)
            preloaded_question_batch = False
            session_fallback_turn = None
            session_closing_turn = None
            # Vendor / employer jobs: the same interview structure as a normal candidate session, but the
            # skill turns ask about skills shared by the job description and the candidate's resume.
            skill_focus = (
                ia.vendor_skill_focus(skill_analysis, required_skills)
                if question_mode in ("vendor_jd", "employer") and skill_analysis
                else []
            )
            # Recruiter job link / invite with a JD: JD-first mix (~80% JD, ~20% resume-to-JD, >=1 behavioural), 20 min.
            jd_first = is_jd_first_interview(
                question_mode=question_mode, job_description=effective_jd, invite_token=invite_token
            )
            job_interview = bool(vendor_job) or bool(is_job) or question_mode in ("employer", "vendor_jd")
            if qmodel["questionModel"] == "non_technical" and not job_interview:
                role = career_role_label(profile if isinstance(profile, dict) else {})
            try:
                batch = await ia.generate_adaptive_question_batch(
                    {
                        "ctx": digest,
                        "profile": profile,
                        "role": role,
                        "level": level,
                        "jobDescription": effective_jd,
                        "accountName": account.get("name") if account else None,
                        "varietySeed": variety_seed,
                        "totalTurns": interview_total_turns,
                        "fresher": fresher,
                        "skillFocus": skill_focus,
                        "jdFirst": jd_first,
                        "jdSkills": (skill_analysis or {}).get("jdSkills") or required_skills,
                        "questionModel": qmodel["questionModel"],
                    }
                )
                questions = batch["questions"]
                jd_first = bool(batch.get("jdFirst"))
                first = questions[0]
                session_fallback_turn = batch.get("fallbackTurn")
                session_closing_turn = batch.get("closingTurn")
                interview_total_turns = int(batch.get("totalTurns") or interview_total_turns)
                preloaded_question_batch = True
            except Exception as err:
                from app.services.interview_llm_questions import InterviewLlmQuestionError

                if isinstance(err, InterviewLlmQuestionError):
                    return _json(err.status, {"error": str(err), "code": err.code})
                raise
            agent_label = first.get("focus") or "adaptive-llm"
            session_id = secrets.token_hex(12)
            # No free interview / credit is taken here: the session is only prepared (`pending`). It is claimed when
            # the candidate enters the room (POST /api/interview/enter) or records the first answer (T5 B11).
            created_at = ivlife.now_iso()
            session = {
                "id": session_id,
                "email": email,
                "role": role,
                "level": level,
                "mode": "adaptive",
                "questions": questions,
                "history": [],
                "answers": [],
                "agent": agent_label,
                "context": digest,
                "jobDescription": effective_jd,
                "explicitRoleTrack": explicit_role_track,
                "jobId": str(vendor_job["id"]) if vendor_job else (str(body["jobId"]) if body.get("jobId") else None),
                "applicationId": str(vendor_application["id"]) if vendor_application else (str(body["applicationId"]) if body.get("applicationId") else None),
                "organizationId": (
                    str(vendor_application["organizationId"])
                    if vendor_application
                    else (str(vendor_job["organizationId"]) if vendor_job else None)
                ),
                "roleTrack": role_track,
                "jdPlan": jd_plan,
                "primarySkills": (skill_analysis or {}).get("jdSkills") or required_skills,
                "skillFocus": skill_focus,
                "inviteToken": invite_token or None,
                "questionMode": question_mode,
                "skillAnalysis": skill_analysis,
                "startedAt": created_at,
                "createdAt": created_at,
                "lastActivityAt": created_at,
                "status": ivlife.STATUS_PENDING,
                "contextKey": context_key,
                "billingPending": "free" if free_claim else ("credit" if retake_charged else None),
                "jobSummary": (
                    {"id": vendor_job["id"], "title": vendor_job.get("title"), "roleTrack": vendor_job.get("roleTrack")}
                    if vendor_job
                    else None
                ),
                "totalTurns": interview_total_turns,
                "varietySeed": variety_seed,
                "preloadedQuestionBatch": preloaded_question_batch,
                "fallbackTurn": session_fallback_turn,
                "jdFirst": jd_first,
                "durationMinutes": JD_INTERVIEW_DURATION_MINUTES if jd_first else None,
                "closingTurn": session_closing_turn,
                "integrity": {"faceViolations": 0, "singlePersonOk": True, "maxFacesSeen": 1},
                "consent": consent_record,
                # Decided on the server (V-06): counts towards the paid-retake rule unless it is a verified job link.
                "careerInterview": not is_job,
                "questionModel": qmodel["questionModel"],
                "questionModelConfidence": qmodel["questionModelConfidence"],
                "questionModelReason": qmodel["questionModelReason"],
            }
            db.setdefault("interviewSessions", {})[session_id] = session
            await ctx.save_db(db)
            return _json(200, _session_start_payload(session_id, session, previous=previous_attempt))

        if method == "POST" and path == "/api/interview/enter":
            # The candidate clicked "Enter interview room": only now does the interview count (free / paid credit).
            email = await runtime.require_auth_email(request)
            body = await runtime.read_json_body(request)
            db = ctx.load_db()
            session_id = str(body.get("sessionId") or "")
            session = (db.get("interviewSessions") or {}).get(session_id)
            if not session or session.get("email") != email:
                return _json(404, {"error": "Interview session not found."})
            if session.get("status") == "completed":
                return _json(409, {"error": "This interview is already finished.", "code": "SESSION_COMPLETED"})
            if session.get("inviteToken") and invite_attempt_used(db, str(session["inviteToken"])):
                return _json(409, {"error": "You have already completed the interview for this invitation.", "code": "INVITE_ALREADY_USED"})
            refused = await _activate_interview_session(session, session_id, email)
            db["interviewSessions"][session_id] = session
            await ctx.save_db(db)
            if refused:
                return refused
            return _json(200, {"ok": True, "sessionId": session_id, "status": session.get("status")})

        if method == "GET" and path == "/api/interview/booking":
            # The candidate's booked slot (lobby countdown / lock in any tab, dashboard "Your interview" card).
            email = await runtime.require_auth_email(request)
            db = ctx.load_db()
            account = await asyncio.to_thread(find_user, db, email=email)
            booking = await _candidate_booking(db, email, account)
            return _json(200, {"booking": booking, "serverNow": ivlife.now_iso()})

        if method == "POST" and path == "/api/interview/answer":
            # Each answer is stored as it is given, so a reload / crash resumes with the answers kept (T5 B9).
            email = await runtime.require_auth_email(request)
            if not ctx.rate_limit(f"ivanswer:{email}", 60):
                return _json(429, {"error": "Answer rate limited."})
            body = await runtime.read_json_body(request)
            db = ctx.load_db()
            session_id = str(body.get("sessionId") or "")
            session = (db.get("interviewSessions") or {}).get(session_id)
            if not session or session.get("email") != email:
                return _json(404, {"error": "Interview session not found."})
            if session.get("status") == "completed":
                return _json(409, {"error": "This interview is already finished.", "code": "SESSION_COMPLETED"})
            refused = await _activate_interview_session(session, session_id, email)
            if refused:
                db["interviewSessions"][session_id] = session
                await ctx.save_db(db)
                return refused
            index = _int_param(body.get("questionIndex"), -1, lo=-1, hi=100)
            if index < 0:
                return _json(400, {"error": "questionIndex is required."})
            history = ivlife.record_answer(
                session, index, body.get("question"), str(body.get("answer") or ""),
                advance_reason=str(body.get("advanceReason") or "") or None,
            )
            db["interviewSessions"][session_id] = session
            await ctx.save_db(db)
            return _json(200, {"ok": True, "answered": len(history)})

        if method == "POST" and path == "/api/contact":
            # Public contact / demo-request form. IP rate limited, stored, and emailed when mail is configured.
            if not ctx.rate_limit(f"contact:{runtime.client_ip(request)}", 5, 3_600_000):
                return _json(429, {"error": "Too many requests. Please try again later."})
            body = await runtime.read_json_body(request)
            name = str(body.get("name") or "").strip()[:120]
            from_email = str(body.get("email") or "").strip().lower()[:200]
            message = str(body.get("message") or "").strip()[:4000]
            kind = "demo" if str(body.get("type") or "") == "demo" else "support"
            if not name or "@" not in from_email or "." not in from_email.split("@")[-1] or len(message) < 5:
                return _json(400, {"error": "Name, a valid email and a message are required."})
            db = ctx.load_db()
            db.setdefault("contactRequests", []).insert(
                0,
                {
                    "id": secrets.token_hex(8),
                    "type": kind,
                    "name": name,
                    "email": from_email,
                    "message": message,
                    "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                },
            )
            # (Old requests are pruned by the daily maintenance job, not by loading the whole list here.)
            await ctx.save_db(db)
            inbox = (os.environ.get("CONTACT_INBOX_EMAIL") or os.environ.get("SMTP_EMAIL") or "").strip()
            if inbox and smtp_configured():
                from html import escape

                async def _notify() -> None:
                    try:
                        await send_mail(
                            to=inbox,
                            subject=f"[HireRighttt] {'Demo request' if kind == 'demo' else 'Contact'} from {name}",
                            html=f"<p><b>{escape(name)}</b> &lt;{escape(from_email)}&gt;</p><p>{escape(message)}</p>",
                            text=f"{name} <{from_email}>\n\n{message}",
                        )
                    except Exception:
                        logger.warning("Contact notification email failed", exc_info=True)

                # Stored in the database either way; the visitor never waits for (or sees) the mail server.
                background.spawn(_notify(), "contact-email")
            return _json(200, {"ok": True})

        if method == "POST" and path == "/api/interview/score":
            email = await runtime.require_auth_email(request)
            if not ctx.rate_limit(f"ivscore:{email}", 10):
                return _json(429, {"error": "Score rate limited."})
            body = await runtime.read_json_body(request)
            db = ctx.load_db()
            session_id = str(body.get("sessionId") or "")
            session = (db.get("interviewSessions") or {}).get(session_id)
            if not session or session.get("email") != email:
                return _json(404, {"error": "Interview session not found."})
            if session.get("status") == "completed" and session.get("result"):
                # Already scored: return the stored result. Re-scoring would let a candidate resubmit answers.
                return _json(
                    200,
                    {
                        "interview": strip_interview_result_for_candidate(session["result"]),
                        "sessionId": session_id,
                        "alreadyScored": True,
                    },
                )
            if session.get("status") in _ENDED_STATUSES:
                return _session_ended_response(session)
            if session_is_stale(session):
                return _json(410, {"error": "This interview session has expired. Please start a new interview.", "code": "SESSION_EXPIRED"})
            refused = await _activate_interview_session(session, session_id, email)
            if refused:
                return refused
            # V-14: role, level (rubric difficulty) and profile come from the server's session / stored profile only.
            profile = await asyncio.to_thread(runtime.merge_interview_profile, db, email, None)
            # The server's own question list is authoritative; client-sent questions only if the session has none.
            raw_questions = session.get("questions") or body.get("questions")
            answers = [str(a)[:20000] for a in (body.get("answers") or [])[:50]]
            role = str(session.get("role") or "Full Stack Engineer")
            level = str(session.get("level") or "1–3 years")
            questions = []
            for q in raw_questions or []:
                if isinstance(q, dict) and q.get("text"):
                    questions.append(q)
                elif isinstance(q, str):
                    questions.append({"text": q, "category": "Technical", "keywords": [], "hint": ""})
            if not questions:
                return _json(400, {"error": "Questions required to score interview."})
            # Answers the server recorded turn by turn win; the browser only supplies the final turn's answer.
            answers = authoritative_answers(session, answers, questions)
            pair_count = min(len(questions), len(answers))
            if not pair_count:
                return _json(400, {"error": "At least one answer is required to score the interview."})
            scored_questions = questions[:pair_count]
            scored_answers = answers[:pair_count]
            user = await asyncio.to_thread(find_user, db, email=email)
            # V-14: proctoring is detected in the browser, but the client may only ADD flags, never remove the ones the
            # server already recorded (session integrity counters and persisted review events).
            client_integrity = merge_server_integrity(
                session, body.get("integrity") if isinstance(body.get("integrity"), dict) else {}
            )
            duration_seconds = None
            try:
                started = datetime.fromisoformat(str(session.get("startedAt") or "").replace("Z", "+00:00"))
                duration_seconds = max(0, int((datetime.now(timezone.utc) - started).total_seconds()))
            except (ValueError, TypeError):
                duration_seconds = None
            result = await ia.score_interview_session(
                {
                    "role": role,
                    "level": level,
                    "questions": scored_questions,
                    "answers": scored_answers,
                    "profile": profile,
                    "integrity": client_integrity,
                    "accountName": user.get("name") if user else None,
                    "durationSeconds": duration_seconds,
                    # Job / vendor interviews: the job's skills (stored on the session when it started).
                    "requiredSkills": (session.get("primarySkills") or []) if session.get("applicationId") else [],
                }
            )
            result["sessionId"] = session_id
            proctoring = await persist_proctoring_flags(
                tenant_id=str(session.get("organizationId") or "platform"),
                session_id=session_id,
                flagged_sections=client_integrity.get("flaggedSections") or [],
            )
            result["integrity"] = {
                **result.get("integrity", {}),
                "logs": client_integrity.get("logs") or [],
                "proctoring": proctoring,
            }
            deviations = count_face_proctor_deviations(client_integrity, proctoring)
            apply_face_deviation_penalty_to_result(result, deviations)
            db.setdefault("interviews", {})[email] = result
            # A job interview belongs to that job's application: the vendor sees this score for this job,
            # not whatever interview the candidate took last.
            scored_application = None
            if session.get("applicationId") and session.get("organizationId"):
                scored_application = update_application_interview(
                    db,
                    str(session["applicationId"]),
                    str(session["organizationId"]),
                    result,
                    {"interviewSessionId": session_id, "interviewSource": "job"},
                )
            session["status"] = "completed"
            session["answers"] = scored_answers
            session["questions"] = scored_questions
            session["result"] = result
            session["completedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            db["interviewSessions"][session_id] = session
            await ctx.save_db(db)
            if scored_application and persistence_ready(config.database_url):
                try:
                    await asyncio.to_thread(db_store.upsert_employer_application_record, config.database_url, scored_application)
                except Exception:
                    logger.exception("Could not save job interview result to application %s", session.get("applicationId"))
            if persistence_ready(config.database_url) and s3_storage_configured():
                # The transcript copy in S3 is for the archive; the candidate does not wait for the upload.
                # The task gets plain copies (never the request's unit of work).
                async def _persist_transcript(
                    session_copy: dict = dict(session), account: dict | None = dict(user) if user else None
                ) -> None:
                    try:
                        await art_store.persist_interview_transcript_to_s3(
                            pool=db_store.db_pool(config.database_url),
                            db={"interviewSessions": {session_id: session_copy}},
                            requesterEmail=email,
                            account=account,
                            sessionId=session_id,
                            questions=scored_questions,
                            answers=scored_answers,
                            result=result,
                        )
                    except Exception:
                        logger.warning("Could not store the interview transcript for session %s", session_id, exc_info=True)

                background.spawn(_persist_transcript(), "persist-transcript")
            if user and persistence_ready(config.database_url):
                background.spawn(
                    upsert_candidate_talent(
                        config.database_url or "", user, db.get("profiles", {}).get(email) or {}, result
                    ),
                    "upsert-candidate-talent",
                )
            return _json(200, {"interview": strip_interview_result_for_candidate(result), "sessionId": session_id})

        if method == "GET" and path == "/api/applications":
            email = await runtime.require_auth_email(request)
            db = ctx.load_db()
            applications = (db.get("applications") or {}).get(email) or []
            if persistence_ready(config.database_url):
                applications = await asyncio.to_thread(db_store.load_job_applications_for_email, config.database_url, email)
                db.setdefault("applications", {})[email] = applications
            applications = [{**row, "jobStatus": "deleted" if row.get("jobStatus") == "deleted" else "active"} for row in applications]
            return _json(200, {"applications": applications})

        if method == "GET" and path.startswith("/api/applications/"):
            app_id = path.replace("/api/applications/", "", 1).strip("/")
            if app_id and "/" not in app_id:
                email = await runtime.require_auth_email(request)
                db = ctx.load_db()
                applications = (db.get("applications") or {}).get(email) or []
                if persistence_ready(config.database_url):
                    applications = await asyncio.to_thread(
                        db_store.load_job_applications_for_email, config.database_url, email
                    )
                    db.setdefault("applications", {})[email] = applications
                found = next((row for row in applications if str(row.get("id")) == app_id), None)
                if not found:
                    return _json(404, {"error": "Application not found."})
                application = {
                    **found,
                    "jobStatus": "deleted" if found.get("jobStatus") == "deleted" else "active",
                }
                employer_status = application.get("employerStatus") or "applied"
                application["timeline"] = application_timeline(employer_status, application.get("appliedAt"))
                return _json(200, {"application": application})

        if method == "POST" and path == "/api/applications":
            email = await runtime.require_auth_email(request)
            body = await runtime.read_json_body(request)
            db = ctx.load_db()
            given_id = body.get("id")
            if given_id is not None and not isinstance(given_id, (str, int)) or isinstance(given_id, bool):
                return _json(400, {"error": "Application id must be a string."})
            if given_id is not None and len(str(given_id)) > 100:
                return _json(400, {"error": "Application id is too long."})
            record = {
                **body,
                "id": str(given_id) if given_id not in (None, "") else secrets.token_hex(6),
                "appliedAt": body.get("appliedAt") or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "status": body.get("status") or "Applied",
            }
            db.setdefault("applications", {}).setdefault(email, [])
            idx = next((i for i, a in enumerate(db["applications"][email]) if a.get("id") == record["id"]), -1)
            if idx >= 0:
                db["applications"][email][idx] = {**db["applications"][email][idx], **record}
            else:
                db["applications"][email].insert(0, record)
            if persistence_ready(config.database_url):
                await asyncio.to_thread(db_store.upsert_job_application_record, config.database_url, email, record)
            await ctx.save_db(db)
            return _json(201, {"applications": db["applications"][email], "application": record})

        if method == "GET" and path == "/api/talent/search":
            email = await runtime.require_auth_email(request)
            db = ctx.load_db()
            user = await asyncio.to_thread(find_user, db, email=email)
            if not user or user.get("role") != "employer":
                return _json(403, {"error": "Employer account required for talent search."})
            tenant = await asyncio.to_thread(runtime.tenant_context_for_user, db, user)
            org_id = _org_id(tenant)
            if not org_id:
                return _json(403, {"error": "No organization linked to this employer account."})
            if not ctx.rate_limit(f"talent-search:{org_id}", 120, 3_600_000):
                return _json(429, {"error": "Too many searches this hour. Try again later."})
            params = request.query_params
            skills = [s.strip()[:80] for s in str(params.get("skills") or "").split(",") if s.strip()][:20]
            min_score: float | None
            try:
                min_score = float(params.get("minScore")) if params.get("minScore") else None
            except ValueError:
                min_score = None
            try:
                result = await search_candidate_talent(
                    config.database_url,
                    org_id,
                    {
                        "q": str(params.get("q") or "")[:200],
                        "location": str(params.get("location") or "")[:120],
                        "experienceYears": str(params.get("experienceYears") or params.get("experience") or "")[:40],
                        "skills": skills,
                        "minScore": min_score,
                        "limit": _int_param(params.get("limit"), 25, lo=1, hi=100),
                        "offset": _int_param(params.get("offset"), 0, lo=0, hi=10_000),
                    },
                )
                result["candidates"] = await asyncio.to_thread(
                    redact_talent_hits, db, org_id, result.get("candidates") or []
                )
                return _json(200, result)
            except Exception:
                logger.exception("Talent search failed")
                return _json(500, {"error": "Search failed. Please try again."})

        if method == "POST" and path == "/api/interview/transcribe":
            await runtime.require_auth_email(request)
            return _json(
                410,
                {
                    "error": "Server-side transcription was removed. The interview app uses on-device Moonshine STT (Silero VAD + WASM).",
                },
            )

        if method == "GET" and path == "/api/interview/flow":
            return _json_etag(request, {"flow": ia.get_interview_interactive_flow_json()}, cache_control="public, max-age=3600")

        if method == "POST" and path == "/api/resume/upload":
            email = await runtime.require_auth_email(request)
            if not object_storage_configured():
                return _json(503, {"error": "Resume object storage is not configured (S3 or Supabase).", "skipped": True})
            body = await runtime.read_json_body(request)
            try:
                parsed = parse_resume_upload_body(body)
            except ValueError as err:
                return _json(getattr(err, "status", 400), {"error": str(err)})
            try:
                db = ctx.load_db()
                account = await asyncio.to_thread(find_user, db, email=email)
                pool = db_store.db_pool(config.database_url)
                uploaded = await upload_resume_to_object_storage(
                    pool=pool,
                    candidateEmail=email,
                    ownerUserId=account.get("id") if account else None,
                    primaryOrganizationId=account.get("primaryOrganizationId") if account else None,
                    filename=parsed["filename"],
                    buffer=parsed["buffer"],
                    contentType=parsed.get("contentType"),
                )
                profile_patch = {
                    "resumeStoragePath": uploaded["storagePath"],
                    "resumeUrl": uploaded["resumeUrl"],
                    "resumeFileId": uploaded.get("fileId"),
                    "storageProvider": uploaded["storageProvider"],
                }
                def _patch_profile() -> None:
                    prev = dict((db.get("profiles") or {}).get(email) or {})
                    db.setdefault("profiles", {})[email] = {
                        **prev,
                        **profile_patch,
                        "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                    }

                await asyncio.to_thread(_patch_profile)
                await ctx.save_db(db)
                return _json(200, {"ok": True, **uploaded})
            except Exception as err:
                status = getattr(err, "status", 502)
                if getattr(err, "skipped", False):
                    return _json(status, {"error": public_object_storage_error(err, "Storage is not configured."), "skipped": True})
                return _json(status, {"error": public_object_storage_error(err, "Resume upload failed. Please try again.")})

        if method == "GET" and path == "/api/resume/download":
            email = await runtime.require_auth_email(request)
            try:
                db = ctx.load_db()
                profile = await asyncio.to_thread(lambda: (db.get("profiles") or {}).get(email) or {})
                account = await asyncio.to_thread(find_user, db, email=email)
                pool = db_store.db_pool(config.database_url)
                # The stored key must be inside THIS account's users/<id>/resume/ folder (V-02).
                signed = await resolve_resume_download_for_user(
                    requesterEmail=email, profile=profile, pool=pool, ownerUserId=(account or {}).get("id")
                )
                accept = request.headers.get("accept") or ""
                if "application/json" in accept or request.query_params.get("format") == "json":
                    return _json(
                        200,
                        {
                            "downloadUrl": signed["url"],
                            "expiresInSeconds": signed.get("expiresInSeconds"),
                            "legacyPublic": bool(signed.get("legacyPublic")),
                        },
                    )
                return RedirectResponse(signed["url"], status_code=302)
            except ValueError as err:
                return _json(getattr(err, "status", 500), {"error": str(err)})

        if path == "/api/confidential/candidates" and method == "GET":
            db = ctx.load_db()
            q = str(request.query_params.get("q") or "").lower().strip()
            status = str(request.query_params.get("status") or "All")
            lst = vault_for_org(db, vault_tenant_id)
            if q:
                lst = [
                    c
                    for c in lst
                    if q in str(c.get("name") or "").lower()
                    or q in str(c.get("email") or "").lower()
                    or q in str(c.get("resumeText") or "").lower()
                ]
            if status and status != "All":
                lst = [c for c in lst if c.get("status") == status]
            return _json(200, {"total": len(lst), "candidates": lst})

        if method == "POST" and path == "/api/interview/next":
            email = await runtime.require_auth_email(request)
            if not ctx.rate_limit(f"ivnext:{email}", 30):
                return _json(429, {"error": "Next-question rate limited."})
            body = await runtime.read_json_body(request)
            db = ctx.load_db()
            session_id = str(body.get("sessionId") or "")
            session = (db.get("interviewSessions") or {}).get(session_id)
            if not session or session.get("email") != email:
                return _json(404, {"error": "Interview session not found."})
            refused = await _activate_interview_session(session, session_id, email)
            if refused:
                db["interviewSessions"][session_id] = session
                await ctx.save_db(db)
                return refused
            session["lastActivityAt"] = ivlife.now_iso()
            profile = await asyncio.to_thread(runtime.merge_interview_profile, db, email, body.get("profile"))
            account = await asyncio.to_thread(find_user, db, email=email)
            digest = ia.summarize_profile(profile, account.get("name") if account else None)
            history = runtime.merge_turn_into_interview_history(
                body.get("history") or session.get("history") or [], body.get("lastQuestion"), body.get("lastAnswer")
            )
            session["history"] = history
            total_turns = session.get("totalTurns") or ia.INTERVIEW_TURN_COUNT
            if len(history) >= total_turns:
                await ctx.save_db(db)
                return _json(200, {"complete": True, "turn": len(history)})
            next_turn = len(history) + 1
            fallback_turn = session.get("fallbackTurn")
            closing_turn = session.get("closingTurn")
            deferred_turn = next_turn in (fallback_turn, closing_turn)
            if session.get("preloadedQuestionBatch") and not deferred_turn:
                cached = (session.get("questions") or [])[next_turn - 1] if session.get("questions") else None
                if isinstance(cached, dict) and len(str(cached.get("text") or "")) >= 24:
                    db["interviewSessions"][session_id] = session
                    await ctx.save_db(db)
                    return _json(200, {"question": cached, "turn": next_turn, "preloaded": True})
            try:
                nxt = await ia.generate_adaptive_question(
                    {
                        "ctx": digest,
                        "profile": profile,
                        "role": body.get("role") or session.get("role"),
                        "level": body.get("level") or session.get("level"),
                        "jobDescription": body.get("jobDescription") or session.get("jobDescription") or "",
                        "history": history,
                        "lastAnswer": str(body.get("lastAnswer") or ""),
                        "accountName": account.get("name") if account else None,
                        "varietySeed": str(body.get("varietySeed") or session.get("varietySeed") or ""),
                        "totalTurns": total_turns,
                        "questionModel": session.get("questionModel"),
                    }
                )
            except Exception as err:
                from app.services.interview_llm_questions import InterviewLlmQuestionError

                if isinstance(err, InterviewLlmQuestionError):
                    return _json(err.status, {"error": str(err), "code": err.code})
                raise
            if session.get("preloadedQuestionBatch") and deferred_turn:
                updated = list(session.get("questions") or [])
                while len(updated) < next_turn:
                    updated.append({"text": "", "focus": "pending"})
                updated[next_turn - 1] = nxt
                session["questions"] = updated
            else:
                session.setdefault("questions", []).append(nxt)
            db["interviewSessions"][session_id] = session
            await ctx.save_db(db)
            return _json(200, {"question": nxt, "turn": next_turn, "preloaded": False})

        if method == "POST" and path == "/api/interview/turn":
            email = await runtime.require_auth_email(request)
            body = await runtime.read_json_body(request)
            db = ctx.load_db()
            profile = await asyncio.to_thread(runtime.merge_interview_profile, db, email, body.get("profile"))
            account = await asyncio.to_thread(find_user, db, email=email)
            digest = ia.summarize_profile(profile, (account or {}).get("name"))
            turn = await ia.generate_interview_turn(
                {
                    "ctx": digest,
                    "profile": profile,
                    "role": body.get("role") or "Full Stack Engineer",
                    "level": body.get("level") or "1–3 years",
                    "question": body.get("question") if isinstance(body.get("question"), dict) else {},
                    "answer": str(body.get("answer") or ""),
                    "questionIndex": _int_param(body.get("questionIndex"), 0, lo=0, hi=100),
                    "totalQuestions": _int_param(body.get("totalQuestions"), 0, lo=0, hi=100),
                    "nextQuestion": body.get("nextQuestion") if isinstance(body.get("nextQuestion"), dict) else {},
                }
            )
            return _json(200, turn)

        if method == "POST" and path == "/api/interview/interact":
            email = await runtime.require_auth_email(request)
            body = await runtime.read_json_body(request)
            db = ctx.load_db()
            profile = await asyncio.to_thread(runtime.merge_interview_profile, db, email, body.get("profile"))
            account = await asyncio.to_thread(find_user, db, email=email)
            digest = ia.summarize_profile(profile, account.get("name") if account else None)
            result = ia.process_interview_interactive(
                {
                    "phase": body.get("phase") or "day_check",
                    "userText": body.get("userText") or "",
                    "role": body.get("role") or "Full Stack Engineer",
                    "profile": profile,
                    "accountName": account.get("name") if account else None,
                    "ctx": digest,
                }
            )
            return _json(200, result)

        if method == "POST" and path == "/api/interview/integrity":
            email = await runtime.require_auth_email(request)
            body = await runtime.read_json_body(request)
            db = ctx.load_db()
            session_id = str(body.get("sessionId") or "")
            session = (db.get("interviewSessions") or {}).get(session_id)
            if not session or session.get("email") != email:
                return _json(404, {"error": "Interview session not found."})
            face_count = _int_param(body.get("faceCount"), 1, lo=0, hi=20)
            integrity = session.setdefault(
                "integrity", {"faceViolations": 0, "singlePersonOk": True, "maxFacesSeen": 1}
            )
            integrity["maxFacesSeen"] = max(int(integrity.get("maxFacesSeen") or 1), face_count)
            if face_count != 1:
                integrity["faceViolations"] = int(integrity.get("faceViolations") or 0) + 1
                integrity["singlePersonOk"] = False
            session["integrity"] = integrity
            db["interviewSessions"][session_id] = session
            await ctx.save_db(db)
            return _json(200, {"integrity": integrity})

        if method == "POST" and path == "/api/interview":
            # V-04: a candidate used to be able to store ANY result here (e.g. overall=100), which employers then saw
            # in rosters and talent search. Only a result the server itself scored for this candidate is accepted;
            # every other field of the body is ignored. (/api/interview/score already saves it; this stays for the
            # browser's sync call, which sends the scored result including its sessionId.)
            email = await runtime.require_auth_email(request)
            body = await runtime.read_json_body(request)
            db = ctx.load_db()
            sid = str(body.get("sessionId") or "").strip()
            session = await asyncio.to_thread(lambda: (db.get("interviewSessions") or {}).get(sid) if sid else None)
            if (
                not session
                or str(session.get("email") or "").lower() != email
                or session.get("status") != "completed"
                or not isinstance(session.get("result"), dict)
            ):
                return _json(400, {"error": "Only interviews scored by the server can be saved.", "code": "SERVER_SCORE_REQUIRED"})
            db.setdefault("interviews", {})[email] = session["result"]
            await ctx.save_db(db)
            return _json(200, {"interview": strip_interview_result_for_candidate(session["result"])})

        if method == "DELETE" and path.startswith("/api/applications/"):
            email = await runtime.require_auth_email(request)
            app_id = path.replace("/api/applications/", "").split("/")[0]
            if not app_id:
                return _json(400, {"error": "Application id required."})
            db = ctx.load_db()
            lst = [a for a in (db.get("applications") or {}).get(email) or [] if str(a.get("id")) != app_id]
            db.setdefault("applications", {})[email] = lst
            if persistence_ready(config.database_url):
                await asyncio.to_thread(db_store.delete_job_application_record, config.database_url, email, app_id)
            await ctx.save_db(db)
            return _json(200, {"applications": lst})

        if path == "/api/interview/review-events" and method in ("GET", "POST", "PATCH"):
            email = await runtime.require_auth_email(request)
            body = {} if method == "GET" else await runtime.read_json_body(request)
            session_id = str(body.get("sessionId") or request.query_params.get("sessionId") or "")
            db = ctx.load_db()
            session = (db.get("interviewSessions") or {}).get(session_id)
            if not session or session.get("email") != email:
                return _json(404, {"error": "Interview not found."})
            if method == "POST":
                try:
                    session["reviewEvents"] = merge_review_events(session.get("reviewEvents"), body.get("events"))
                except ValueError as err:
                    return _json(400, {"error": str(err)})
            if method == "PATCH":
                event = next((e for e in session.get("reviewEvents") or [] if e.get("id") == body.get("eventId")), None)
                if not event:
                    return _json(404, {"error": "Event not found."})
                expl = body.get("explanation")
                if not isinstance(expl, str) or len(expl) > 2000:
                    return _json(400, {"error": "Explanation must be at most 2000 characters."})
                event["candidateExplanation"] = expl.strip()
                event["explainedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            if method != "GET":
                await ctx.save_db(db)
            return _json(200, {"events": session.get("reviewEvents") or []})

        if method == "POST" and path == "/api/resume/parse":
            if is_prod_like:
                email = await runtime.require_auth_email(request)
                if not ctx.rate_limit(f"resume:{email}", 25, 60_000):
                    return _json(429, {"error": "Too many resume parse requests. Try again shortly."})
            elif not ctx.rate_limit(f"resume:{ip}", 30, 60_000):
                return _json(429, {"error": "Too many resume parse requests. Try again shortly."})
            try:
                client_text, file_name, file_bytes = await _read_resume_parse_parts(request)
            except _ResumeUploadError as err:
                return _json(err.status, {"ok": False, "error": err.error})
            return await _resume_parse_response(client_text, file_name, file_bytes)

        if method == "POST" and path == "/api/resume/replace":
            email = await runtime.require_auth_email(request)
            if not ctx.rate_limit(f"resume-replace:{email}", 8, 60_000):
                return _json(429, {"error": "Too many resume updates. Try again shortly."})
            body = await runtime.read_json_body(request)
            try:
                db = ctx.load_db()
                result = await replace_candidate_resume(config=config, email=email, body=body, db=db, save_db=ctx.save_db)
                timing = str(result.pop("_serverTiming", "") or "")
                headers = {"Server-Timing": timing} if timing else None
                return _json(200, {"ok": True, **result}, headers=headers)
            except Exception as err:
                mapped = public_replace_resume_error(err)
                return _json(mapped["status"], mapped["body"])

        if method == "GET" and path == "/api/interview/recordings/playback":
            email = await runtime.require_auth_email(request)
            # Interview videos are not exposed to candidates; admins/recruiters use the vendor endpoints.
            return _json(403, {"error": "Interview recordings are not available to candidates."})

        if method == "POST" and path == "/api/interview/recordings/upload":
            email = await runtime.require_auth_email(request)
            if not s3_storage_configured():
                return _json(503, {"error": "Recording storage is not configured (S3).", "skipped": True})
            if not persistence_ready(config.database_url):
                return _json(503, {"error": "Database required for interview recordings."})
            form = await request.form()
            upload = form.get("file")
            if upload is None or not hasattr(upload, "read"):
                return _json(400, {"error": "Recording file is required."})
            # Starlette spooled the upload to a temp file; measure it and stream it to S3 (never 100 MB in memory).
            upload.file.seek(0, 2)
            upload_size = upload.file.tell()
            upload.file.seek(0)
            filename = str(form.get("filename") or getattr(upload, "filename", "") or "interview_recording.webm")[:200]
            content_type = str(getattr(upload, "content_type", "") or form.get("contentType") or "")
            duration_raw = form.get("durationSeconds")
            try:
                duration_seconds = int(float(duration_raw)) if duration_raw not in (None, "") else None
            except (TypeError, ValueError):
                duration_seconds = None
            try:
                db = ctx.load_db()
                account = await asyncio.to_thread(find_user, db, email=email)
                pool = db_store.db_pool(config.database_url)
                out = await rec_store.store_interview_recording_bytes(
                    pool=pool,
                    db=db,
                    requesterEmail=email,
                    account=account,
                    sessionId=str(form.get("sessionId") or ""),
                    filename=filename,
                    contentType=content_type,
                    fileobj=upload.file,
                    size=upload_size,
                    durationSeconds=duration_seconds,
                )
                return _json(200, out)
            except rec_store.StorageError as err:
                body: dict[str, Any] = {"error": str(err)}
                if err.skipped:
                    body["skipped"] = True
                return _json(err.status, body)

        if method == "POST" and path == "/api/interview/recordings/upload-url":
            email = await runtime.require_auth_email(request)
            if not s3_storage_configured():
                return _json(503, {"error": "Recording storage is not configured (S3).", "skipped": True})
            if not persistence_ready(config.database_url):
                return _json(503, {"error": "Database required for interview recordings."})
            body = await runtime.read_json_body(request)
            try:
                db = ctx.load_db()
                account = find_user(db, email=email)
                pool = db_store.db_pool(config.database_url)
                out = await rec_store.authorize_interview_recording_upload(
                    pool=pool,
                    db=db,
                    requesterEmail=email,
                    account=account,
                    sessionId=str(body.get("sessionId") or ""),
                    filename=str(body.get("filename") or "interview_recording.webm"),
                    contentType=str(body.get("contentType") or ""),
                    fileSize=_int_param(body.get("fileSize"), 0, lo=0, hi=10**12),
                )
                return _json(200, {"ok": True, **out})
            except rec_store.StorageError as err:
                body = {"error": str(err)}
                if getattr(err, "skipped", False):
                    body["skipped"] = True
                return _json(err.status, body)
            except NotImplementedError as err:
                return _json(501, {"error": str(err)})

        if method == "POST" and path == "/api/interview/recordings/complete":
            email = await runtime.require_auth_email(request)
            if not persistence_ready(config.database_url):
                return _json(503, {"error": "Database required for interview recordings."})
            body = await runtime.read_json_body(request)
            try:
                pool = db_store.db_pool(config.database_url)
                duration = body.get("durationSeconds")
                out = await rec_store.complete_interview_recording_upload(
                    pool=pool,
                    requesterEmail=email,
                    recordingId=str(body.get("recordingId") or ""),
                    sessionId=str(body.get("sessionId") or ""),
                    durationSeconds=duration if isinstance(duration, (int, float)) else None,
                )
                return _json(200, {"ok": True, **out})
            except rec_store.StorageError as err:
                return _json(err.status, {"error": str(err)})
            except NotImplementedError as err:
                return _json(501, {"error": str(err)})

        if method == "GET" and path.startswith("/api/interview-invites/"):
            token = path.replace("/api/interview-invites/", "").strip()
            if not token:
                return _json(400, {"error": "Invite token required."})
            # Public lookup: throttle by IP and token to reduce scanning / abuse (Vulnerability Scan iteration 2).
            if not ctx.rate_limit(f"ivinvite-ip:{ctx.client_ip(request)}", 120, 3_600_000):
                return _json(429, {"error": "Too many invite lookups. Try again later."})
            if not ctx.rate_limit(f"ivinvite-token:{token[:48]}", 40, 3_600_000):
                return _json(429, {"error": "Too many requests for this invite link."})
            if not persistence_ready(config.database_url):
                return _json(503, {"error": "Database required for interview invites."})
            pool = db_store.db_pool(config.database_url)
            row = await get_interview_invite_by_token(pool, token)
            if not row:
                return _json(404, {"error": "Invite not found."})
            server_now = datetime.now(timezone.utc)
            access = invite_access_state(row, server_now)
            if access.get("status") == "invalid":
                return _json(410, {"error": "This invitation has an invalid schedule. Ask for a new link."})
            db = ctx.load_db()
            org_id = row.get("organization_id")
            job = get_org_job(db, org_id, row.get("job_id")) if org_id and row.get("job_id") else None
            app = get_org_application(db, org_id, row.get("application_id")) if org_id and row.get("application_id") else None
            ctx_json = parse_invite_context(row)
            viewer_email = None
            try:
                viewer_email = await runtime.require_auth_email(request)
            except Exception:
                viewer_email = None
            is_invitee = bool(viewer_email) and viewer_email == str(row.get("candidate_email") or "").strip().lower()
            if (is_invitee or not viewer_email) and not row.get("opened_at"):
                # "Link opened" on the recruiter's invite status (a recruiter previewing the link does not count).
                from app.services.vendor.invite_status import mark_invite_opened

                try:
                    await asyncio.to_thread(mark_invite_opened, pool, token)
                except Exception:
                    logger.warning("Could not record invite open", exc_info=True)
            resume_text = ctx_json.get("resumeText") or (app or {}).get("data", {}).get("resumeText") or (db.get("profiles") or {}).get(row.get("candidate_email"), {}).get("resumeText") or ""
            job_description = ctx_json.get("jobDescription") or (job or {}).get("jobDescription") or (app or {}).get("data", {}).get("jobDescription") or ""
            resume_ready = len(str(resume_text or "").strip()) > 20
            if not is_invitee:
                # Anyone holding the link can see the invite details, but not the candidate's resume or the job description.
                resume_text = ""
                job_description = ""
            can_reschedule = False
            if is_invitee:
                from app.dispatch.schedule_routes import reschedule_refusal

                viewer = find_user(db, email=viewer_email)
                can_reschedule = reschedule_refusal(row, viewer, db) is None
            return _json(
                200,
                {
                    "invite": {
                        "token": row.get("token"),
                        "serverNow": server_now.isoformat().replace("+00:00", "Z"),
                        "candidateEmail": row.get("candidate_email"),
                        "candidateName": candidate_display_name(
                            db, row.get("candidate_email"), resume_text=resume_text, given=row.get("candidate_name")
                        ),
                        "jobTitle": row.get("job_title") or (job or {}).get("title") or ctx_json.get("jobTitle"),
                        "scheduledStart": row.get("scheduled_start"),
                        "scheduledEnd": row.get("scheduled_end"),
                        "applicationId": row.get("application_id"),
                        "jobId": row.get("job_id"),
                        "organizationId": org_id,
                        "jobDescription": job_description,
                        "resumeText": resume_text,
                        "resumeReady": resume_ready,
                        "signedInAsInvitee": is_invitee,
                        "resumeName": ctx_json.get("resumeName") or (app or {}).get("data", {}).get("resumeName"),
                        "roleTrack": ctx_json.get("roleTrack") or (job or {}).get("roleTrack") or "",
                        "experienceLevel": ctx_json.get("experienceLevel") or (job or {}).get("experienceLevel") or "",
                        "company": (job or {}).get("company") or "",
                        "primarySkills": ctx_json.get("primarySkills") or (app or {}).get("data", {}).get("primarySkills") or (job or {}).get("requiredSkills") or [],
                        # Recruiter-side match scores: only for the signed-in invitee, not for anyone holding the link.
                        "atsScore": (app or {}).get("data", {}).get("atsScore") if is_invitee else None,
                        "jdMatchScore": (app or {}).get("data", {}).get("jdMatchScore") if is_invitee else None,
                        "contextSource": ctx_json.get("source"),
                        "status": access.get("status"),
                        "canStart": access.get("canStart"),
                        "canReschedule": can_reschedule,
                        # Latest reminder for this slot (emailed, or recorded in-app while email is off).
                        "reminder": _invite_reminder_info(row) if is_invitee else None,
                        "interviewPath": f"/interview/invite/{row.get('token')}",
                    }
                },
            )

        if method == "GET" and path.startswith("/api/talent/candidates/"):
            email = await runtime.require_auth_email(request)
            db = ctx.load_db()
            user = await asyncio.to_thread(find_user, db, email=email)
            if not user or user.get("role") != "employer":
                return _json(403, {"error": "Employer account required."})
            tenant = await asyncio.to_thread(runtime.tenant_context_for_user, db, user)
            org_id = _org_id(tenant)
            if not org_id:
                return _json(403, {"error": "No organization linked to this employer account."})
            user_id = path.replace("/api/talent/candidates/", "").split("/")[0][:64]
            candidate = await get_candidate_talent_by_id(config.database_url, org_id, user_id)
            if not candidate:
                return _json(404, {"error": "Candidate not found or not visible."})
            interview = await asyncio.to_thread(lambda: (db.get("interviews") or {}).get(candidate["email"]))
            # Owner decision: the full report (answers, feedback, proctoring) for any employer-visible candidate.
            redacted = await asyncio.to_thread(redact_talent_hits, db, org_id, [candidate])
            return _json(200, {"candidate": redacted[0], "interview": interview})

    except HTTPException as exc:
        return _json(exc.status_code, {"error": exc.detail})
    except NotImplementedError as exc:
        return _json(501, {"error": str(exc)})
    except Exception:
        # Never swallow errors silently: without this line a failing endpoint is invisible in production logs.
        logger.exception("API dispatch failed for %s %s", method, path)
        return _json(500, {"error": "Server error"})

    from app.dispatch.schedule_routes import try_schedule_routes

    try:
        sched = await try_schedule_routes(request, ctx, _json)
    except HTTPException as err:
        return _json(err.status_code, {"error": err.detail if isinstance(err.detail, str) else "Request failed."})
    if sched is not None:
        return sched

    from app.dispatch.payment_routes import try_payment_routes

    try:
        paid = await try_payment_routes(request, ctx, _json)
    except HTTPException as err:
        return _json(err.status_code, {"error": err.detail if isinstance(err.detail, str) else "Request failed."})
    if paid is not None:
        return paid

    from app.dispatch.route_extensions import try_extended_routes

    ext = await try_extended_routes(request, ctx, vault_tenant_id, _json, _vendor_recruiter_scope)
    if ext is not None:
        return ext

    return None
