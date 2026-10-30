"""Primary /api/* dispatch (jobs, vendor, interview, resume, talent, vault)."""

from __future__ import annotations

import asyncio
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
from app.db.talent_index import (
    get_candidate_talent_by_id,
    grant_organization_talent_access,
    search_candidate_talent,
    upsert_candidate_talent,
)
from app.dispatch.context import DispatchContext
from app.node_config import config, is_prod_like
from app.proctoring.strip_proctoring import strip_interview_result_for_candidate
from app.server import runtime
from app.services.ats_composite import compute_employer_interview_composite
from app.services import interview_api as ia
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
from app.services.interview_review import vendor_may_view_interview_session
from app.services.mail_service import send_mail, smtp_configured
from app.services.proctoring.persist_flags import persist_proctoring_flags, review_logs_to_flag_sections
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
    mark_candidate_job_applications_deleted,
    record_candidate_job_application,
)
from app.services.vendor.candidate_documents import (
    assert_vendor_may_view_candidate_documents,
    candidate_profile_for_documents,
)
from app.services.vendor.job_role_match import apply_candidate_job_scope
from app.services.vendor.jobs import (
    attach_candidate_report_to_application,
    create_job_application,
    create_vendor_job,
    delete_vendor_job,
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
)
from app.services.vendor.org_candidates import list_job_candidates, list_organization_candidates

PADDLE_SCRIPT = Path(__file__).resolve().parents[2] / "paddle_resume_parser.py"


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
    return JSONResponse(status_code=status, content=body, headers=h)


def _vendor_recruiter_scope(access: dict) -> dict:
    user = access["user"]
    return {"createdByUserId": user.get("id"), "createdByEmail": user.get("email")}


def _is_open_vendor_job(job: dict | None) -> bool:
    status = str((job or {}).get("status") or "published").lower()
    return status in ("active", "published")


async def _resolve_vendor_job_for_interview(db: dict, body: dict, email: str) -> dict:
    if body.get("applicationId"):
        app = next((a for a in db.get("employerApplications") or [] if a.get("id") == str(body["applicationId"])), None)
        if not app:
            return {"error": {"status": 404, "message": "Application not found."}}
        if str(app.get("candidateEmail") or "").lower() != str(email or "").lower():
            return {"error": {"status": 403, "message": "This application does not belong to your account."}}
        job = get_org_job(db, app["organizationId"], app["jobId"])
        if not job and config.database_url:
            await asyncio.to_thread(db_store.sync_open_jobs_from_database, config.database_url, db)
            job = get_org_job(db, app["organizationId"], app["jobId"])
        if not job:
            return {"error": {"status": 404, "message": "Job not found for this application."}}
        return {"job": job, "application": app}
    if body.get("jobId"):
        job = next((j for j in db.get("jobs") or [] if j.get("id") == str(body["jobId"])), None)
        if not job and config.database_url:
            await asyncio.to_thread(db_store.sync_open_jobs_from_database, config.database_url, db)
            job = next((j for j in db.get("jobs") or [] if j.get("id") == str(body["jobId"])), None)
        if not job or not _is_open_vendor_job(job):
            return {"error": {"status": 404, "message": "Job not found or not open."}}
        return {"job": job, "application": None}
    return {"job": None, "application": None}


async def _run_paddle(buffer: bytes, filename: str) -> dict | None:
    if not PADDLE_SCRIPT.is_file():
        return None
    suffix = Path(filename).suffix or ".pdf"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(buffer)
        path = tmp.name
    cmd = [sys.executable, str(PADDLE_SCRIPT), path]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if out.returncode != 0:
            return None
        import json

        parsed = json.loads(out.stdout.strip())
        return parsed if parsed and not parsed.get("error") else None
    except Exception:
        return None
    finally:
        Path(path).unlink(missing_ok=True)


async def handle_api_dispatch(request: Request, ctx: DispatchContext) -> Response | None:
    path = request.url.path
    method = request.method.upper()
    ip = ctx.client_ip(request)
    vault_tenant_id: str | None = None

    try:
        if path.startswith("/api/confidential/"):
            email = await runtime.require_auth_email(request)
            db = ctx.load_db()
            user = next((u for u in db.get("users") or [] if u.get("email") == email and u.get("status") != "disabled"), None)
            tenant = runtime.tenant_context_for_user(db, user)
            if (
                user.get("role") != "employer"
                or tenant.get("organization", {}).get("status") != "active"
                or (tenant.get("membership") or {}).get("role") not in ("owner", "admin", "recruiter")
            ):
                return _json(403, {"error": "Recruiter organization access required"})
            vault_tenant_id = tenant["organization"]["id"]

        if method == "GET" and path == "/api/candidate/job-alerts":
            email = await runtime.require_auth_email(request)
            db = ctx.load_db()
            user = next((u for u in db.get("users") or [] if u.get("email") == email), None)
            if user and user.get("role") == "employer":
                return _json(403, {"error": "Candidates only."})
            return _json(200, {"alerts": list_candidate_job_alerts(db, email)})

        if method == "GET" and path == "/api/jobs":
            email = await runtime.require_auth_email(request)
            db = ctx.load_db()
            if config.database_url:
                await asyncio.to_thread(db_store.sync_open_jobs_from_database, config.database_url, db)
            params = request.query_params
            summary = params.get("summary") == "1"
            scope = "all" if params.get("scope") == "all" else "matched"
            mapper = public_job_list_payload if summary else public_job_payload
            open_jobs = list_open_jobs(db)
            scoped = apply_candidate_job_scope(db, email, open_jobs, scope)
            open_jobs = scoped["jobs"]
            meta = scoped["meta"]
            limit_raw = params.get("limit")
            if limit_raw:
                safe_limit = max(1, min(50, int(limit_raw or 4)))
                safe_offset = max(0, int(params.get("offset") or 0))
                page = open_jobs[safe_offset : safe_offset + safe_limit]
                return _json(
                    200,
                    {
                        "jobs": [mapper(j) for j in page],
                        "total": len(open_jobs),
                        "limit": safe_limit,
                        "offset": safe_offset,
                        **meta,
                    },
                )
            jobs = [mapper(j) for j in open_jobs]
            return _json(200, {"jobs": jobs, "total": len(jobs), **meta})

        if method == "GET" and path.startswith("/api/jobs/public/"):
            parsed = parse_public_job_path(path)
            if parsed.get("isApply") or not parsed.get("code"):
                return _json(404, {"error": "Job link not found or expired."})
            db = ctx.load_db()
            job = await resolve_public_job(db, config.database_url, parsed["code"], parsed.get("companySlug"))
            if not job:
                return _json(404, {"error": "Job link not found or expired."})
            return _json(200, {"job": public_job_payload(job)})

        if method == "POST" and path.startswith("/api/jobs/public/") and path.endswith("/apply"):
            parsed = parse_public_job_path(path)
            body = await runtime.read_json_body(request)
            db = ctx.load_db()
            if config.database_url:
                await asyncio.to_thread(db_store.sync_open_jobs_from_database, config.database_url, db)
            job = await resolve_public_job(db, config.database_url, parsed["code"], parsed.get("companySlug"))
            if not job:
                return _json(404, {"error": "Job link not found or expired."})
            session_email = await runtime.require_auth_email(request)
            body_email = str(body.get("candidateEmail") or "").strip().lower()
            if body_email and body_email != session_email:
                return _json(403, {"error": "Application email must match your signed-in candidate account."})
            u = next((x for x in db.get("users") or [] if x.get("email") == session_email), None)
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
                    "candidateName": body.get("candidateName") or profile.get("fullName") or profile.get("name") or (u or {}).get("name"),
                    "candidatePhone": body.get("candidatePhone") or profile.get("contactPhone") or (u or {}).get("phone"),
                    "candidateRole": body.get("candidateRole") or profile.get("currentRole") or "",
                    "experienceYears": body.get("experienceYears") or profile.get("totalExperience") or "",
                    "resumeName": body.get("resumeName") or profile.get("resumeName") or "HireRight profile",
                    "resumeText": resume_text,
                    "candidateEmail": session_email,
                    "candidateUserId": (u or {}).get("id"),
                    "atsEvaluation": ats_evaluation,
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
            if config.database_url:
                await asyncio.to_thread(db_store.upsert_employer_application_record, config.database_url, application)
                await asyncio.to_thread(
                    db_store.upsert_job_application_record, config.database_url, session_email, candidate_application
                )
            await ctx.save_db(db)
            if (u or {}).get("id") and config.database_url:
                asyncio.create_task(
                    grant_organization_talent_access(config.database_url, job["organizationId"], u["id"], "application")
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
                if config.database_url:
                    await asyncio.to_thread(db_store.upsert_job_record, config.database_url, job)
                    try:
                        await asyncio.to_thread(db_store.sync_open_jobs_from_database, config.database_url, db)
                    except Exception:
                        pass
                return _json(201, {"job": public_job_payload(job), "matchAlertsQueued": len(match_alert_emails)})
            except ValueError as err:
                if job and job.get("id"):
                    db["jobs"] = [j for j in db.get("jobs") or [] if j.get("id") != job["id"]]
                return _json(getattr(err, "status", 400), {"error": str(err)})
            except Exception:
                if job and job.get("id"):
                    db["jobs"] = [j for j in db.get("jobs") or [] if j.get("id") != job["id"]]
                raise

        if method == "GET" and path == "/api/vendor/jobs":
            db = ctx.load_db()
            access = await runtime.require_employer_tenant(request, db)
            org_id = access["tenant"]["organization"]["id"]
            if config.database_url:
                await asyncio.to_thread(db_store.sync_org_jobs_from_database, config.database_url, db, org_id)
            scope = _vendor_recruiter_scope(access)
            jobs = [public_job_payload(j) for j in list_org_jobs(db, org_id, scope)]
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
            if config.database_url:
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
                if config.database_url:
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
            if config.database_url:
                await asyncio.to_thread(db_store.sync_employer_applications_from_database, config.database_url, db)
            job_id = path.split("/")[4]
            scope = _vendor_recruiter_scope(access)
            job = get_org_job_for_recruiter(db, access["tenant"]["organization"]["id"], job_id, scope)
            if not job:
                return _json(404, {"error": "Job not found."})
            applicants = [
                attach_candidate_report_to_application(db, app, app.get("candidateEmail"), {"attachInterviewReport": True})
                for app in list_job_applications(db, access["tenant"]["organization"]["id"], job_id)
            ]
            return _json(200, {"job": job, "applicants": applicants, "total": len(applicants)})

        if method == "GET" and path == "/api/vendor/candidates":
            db = ctx.load_db()
            access = await runtime.require_employer_tenant(request, db)
            if config.database_url:
                await asyncio.to_thread(db_store.sync_employer_applications_from_database, config.database_url, db)
            org_id = access["tenant"]["organization"]["id"]
            params = request.query_params
            filters = {
                "name": params.get("name") or "",
                "job": params.get("job") or "",
                "experienceYears": params.get("experienceYears") or params.get("experience") or "",
                "keywords": params.get("keywords") or params.get("q") or "",
                "jobId": params.get("jobId") or "",
            }
            roster = await list_organization_candidates(
                db, org_id, config.database_url, filters, _vendor_recruiter_scope(access)
            )
            return _json(200, {"organizationId": org_id, **roster})

        if method == "GET" and path == "/api/vendor/candidate-documents/resume":
            db = ctx.load_db()
            access = await runtime.require_employer_tenant(request, db)
            candidate_email = str(request.query_params.get("email") or "").strip()
            try:
                assert_vendor_may_view_candidate_documents(
                    db, access["tenant"]["organization"]["id"], candidate_email, _vendor_recruiter_scope(access)
                )
                profile = candidate_profile_for_documents(db, candidate_email)
                pool = db_store.db_pool(config.database_url)
                signed = await resolve_resume_download_from_profile(profile, pool, inline=True)
                return _json(
                    200,
                    {
                        "viewUrl": signed["url"],
                        "downloadUrl": signed["url"],
                        "expiresInSeconds": signed.get("expiresInSeconds"),
                        "contentType": signed.get("contentType"),
                        "filename": signed.get("filename"),
                    },
                )
            except ValueError as err:
                return _json(getattr(err, "status", 500), {"error": str(err)})

        if method == "GET" and re.match(r"^/api/vendor/jobs/[^/]+/candidates$", path):
            db = ctx.load_db()
            access = await runtime.require_employer_tenant(request, db)
            if config.database_url:
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
                candidateName=app["data"].get("candidateName") or app.get("candidateEmail"),
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
            scope = _vendor_recruiter_scope(access)
            app = get_org_application_for_recruiter(db, access["tenant"]["organization"]["id"], app_id, scope)
            if not app:
                return _json(404, {"error": "Applicant not found."})
            job = get_org_job_for_recruiter(db, access["tenant"]["organization"]["id"], app["jobId"], scope)
            jd = str((job or {}).get("jobDescription") or "")
            required = (job or {}).get("requiredSkills") or app.get("data", {}).get("primarySkills") or []
            profile = {
                "resumeText": app.get("data", {}).get("resumeText") or "",
                "workExperiences": app.get("data", {}).get("workExperiences") or [],
                "skills": app.get("data", {}).get("skills") or [],
                "experienceYears": app.get("data", {}).get("experienceYears") or "",
            }
            digest = ia.summarize_profile(profile, app.get("data", {}).get("candidateName") or app.get("candidateEmail"))
            skill_analysis = ia.analyze_interview_skill_match(
                job_description=jd, required_skills=required, profile=profile, ctx=digest
            )
            role = (job or {}).get("roleTrack") or (job or {}).get("title") or app.get("data", {}).get("jobTitle") or "Engineer"
            level = app.get("data", {}).get("experienceYears") or (job or {}).get("experienceLevel") or "1–3 years"
            questions = []
            history = []
            for _ in range(ia.INTERVIEW_TURN_COUNT):
                q = ia.generate_adaptive_question_local(
                    {
                        "ctx": digest,
                        "role": role,
                        "level": level,
                        "jobDescription": jd,
                        "history": history,
                        "lastAnswer": "",
                    }
                )
                questions.append(q)
                history.append({"question": q, "answer": ""})
            return _json(
                200,
                {
                    "questionMode": "adaptive",
                    "role": role,
                    "level": level,
                    "skillAnalysis": skill_analysis,
                    "questions": [{"text": q["text"], "category": q.get("category"), "topic": q.get("topic")} for q in questions],
                },
            )

        if method == "POST" and path == "/api/interview/start":
            email = await runtime.require_auth_email(request)
            if not ctx.rate_limit(f"ivstart:{email}", 12):
                return _json(429, {"error": "Interview start rate limited. Wait a minute."})
            body = await runtime.read_json_body(request)
            if body.get("inviteToken") and config.database_url:
                pool = db_store.db_pool(config.database_url)
                invite = await get_interview_invite_by_token(pool, str(body["inviteToken"]))
                access = validate_invite_start(invite, email)
                if not access.get("ok"):
                    return _json(access["status"], {"error": access["error"], "code": "INVITE_ACCESS_DENIED"})
            db = ctx.load_db()
            profile = runtime.merge_interview_profile(db, email, body.get("profile"))
            account = next((u for u in db.get("users") or [] if u.get("email") == email), None)
            digest = ia.summarize_profile(profile, account.get("name") if account else None)
            vendor_resolved = await _resolve_vendor_job_for_interview(db, body, email)
            if vendor_resolved.get("error"):
                err = vendor_resolved["error"]
                return _json(err["status"], {"error": err["message"]})
            vendor_job = vendor_resolved.get("job")
            vendor_application = vendor_resolved.get("application")
            role = str(body.get("role") or "Full Stack Engineer")
            level = str(body.get("level") or "1–3 years")
            job_description = str(body.get("jobDescription") or "")
            explicit_role_track = body.get("explicitRoleTrack") is True
            question_mode_hint = str(body.get("questionMode") or "").strip()
            job_record = next((j for j in db.get("jobs") or [] if j.get("id") == str(body.get("jobId") or "")), None) if body.get("jobId") else None
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
            interview_total_turns = (
                ia.FRESHER_INTERVIEW_TURN_COUNT
                if ia._is_fresher(profile, level, digest)
                else ia.INTERVIEW_TURN_COUNT
            )
            if question_mode == "vendor_jd":
                first = await ia.generate_vendor_job_question(
                    {
                        "ctx": digest,
                        "profile": profile,
                        "role": role,
                        "jobDescription": effective_jd,
                        "requiredSkills": required_skills,
                        "history": [],
                        "lastAnswer": "",
                        "varietySeed": variety_seed,
                    }
                )
            else:
                first = await ia.generate_adaptive_question(
                    {
                        "ctx": digest,
                        "profile": profile,
                        "role": role,
                        "level": level,
                        "jobDescription": effective_jd,
                        "explicitRoleTrack": explicit_role_track,
                        "history": [],
                        "lastAnswer": "",
                        "accountName": account.get("name") if account else None,
                        "varietySeed": variety_seed,
                    }
                )
            questions = [first]
            agent_label = first.get("focus") or "adaptive-local"
            session_id = secrets.token_hex(12)
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
                "questionMode": question_mode,
                "skillAnalysis": skill_analysis,
                "startedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "status": "active",
                "totalTurns": interview_total_turns,
                "varietySeed": variety_seed,
                "integrity": {"faceViolations": 0, "singlePersonOk": True, "maxFacesSeen": 1},
            }
            db.setdefault("interviewSessions", {})[session_id] = session
            await ctx.save_db(db)
            return _json(
                200,
                {
                    "sessionId": session_id,
                    "agent": agent_label,
                    "adaptive": True,
                    "llm": ia.llm_configured(),
                    "total": interview_total_turns,
                    "questionIndex": 0,
                    "question": questions[0],
                    "questions": questions,
                    "varietySeed": variety_seed,
                    "profileDigest": digest,
                    "questionMode": question_mode,
                    "skillAnalysis": (
                        {
                            "jdSkills": skill_analysis.get("jdSkills"),
                            "matchedSkills": skill_analysis.get("matchedSkills"),
                            "missingSkills": skill_analysis.get("missingSkills"),
                            "atsScore": skill_analysis.get("atsScore"),
                            "jdMatchScore": skill_analysis.get("jdMatchScore"),
                        }
                        if skill_analysis
                        else None
                    ),
                    "job": (
                        {"id": vendor_job["id"], "title": vendor_job.get("title"), "roleTrack": vendor_job.get("roleTrack")}
                        if vendor_job
                        else None
                    ),
                },
            )

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
            profile = runtime.merge_interview_profile(db, email, body.get("profile"))
            raw_questions = body.get("questions") or session.get("questions")
            answers = [str(a) for a in body.get("answers") or []]
            role = str(body.get("role") or session.get("role") or "Full Stack Engineer")
            level = str(body.get("level") or session.get("level") or "1–3 years")
            questions = []
            for q in raw_questions or []:
                if isinstance(q, dict) and q.get("text"):
                    questions.append(q)
                elif isinstance(q, str):
                    questions.append({"text": q, "category": "Technical", "keywords": [], "hint": ""})
            if not questions:
                return _json(400, {"error": "Questions required to score interview."})
            pair_count = min(len(questions), len(answers))
            if not pair_count:
                return _json(400, {"error": "At least one answer is required to score the interview."})
            scored_questions = questions[:pair_count]
            scored_answers = answers[:pair_count]
            user = next((u for u in db.get("users") or [] if u.get("email") == email), None)
            client_integrity = body.get("integrity") if isinstance(body.get("integrity"), dict) else {}
            result = await ia.score_interview_session(
                {
                    "role": role,
                    "level": level,
                    "questions": scored_questions,
                    "answers": scored_answers,
                    "profile": profile,
                    "integrity": client_integrity,
                    "accountName": user.get("name") if user else None,
                }
            )
            result["sessionId"] = session_id
            proctoring = await persist_proctoring_flags(
                tenant_id=str(session.get("organizationId") or "platform"),
                session_id=session_id,
                flagged_sections=client_integrity.get("flaggedSections")
                or review_logs_to_flag_sections(client_integrity.get("logs") or session.get("reviewEvents") or []),
            )
            result["integrity"] = {
                **result.get("integrity", {}),
                "logs": session.get("reviewEvents") or client_integrity.get("logs") or [],
                "proctoring": proctoring,
            }
            db.setdefault("interviews", {})[email] = result
            session["status"] = "completed"
            session["answers"] = scored_answers
            session["questions"] = scored_questions
            session["result"] = result
            session["completedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            db["interviewSessions"][session_id] = session
            await ctx.save_db(db)
            if config.database_url and s3_storage_configured():
                try:
                    pool = db_store.db_pool(config.database_url)
                    await art_store.persist_interview_transcript_to_s3(
                        pool=pool,
                        db=db,
                        requesterEmail=email,
                        account=user,
                        sessionId=session_id,
                        questions=scored_questions,
                        answers=scored_answers,
                        result=result,
                    )
                except Exception:
                    pass
            if user and config.database_url:
                asyncio.create_task(upsert_candidate_talent(config.database_url, user, db.get("profiles", {}).get(email) or {}, result))
            return _json(200, {"interview": strip_interview_result_for_candidate(result), "sessionId": session_id})

        if method == "GET" and path == "/api/applications":
            email = await runtime.require_auth_email(request)
            db = ctx.load_db()
            applications = (db.get("applications") or {}).get(email) or []
            if config.database_url:
                applications = await asyncio.to_thread(db_store.load_job_applications_for_email, config.database_url, email)
                db.setdefault("applications", {})[email] = applications
            applications = [{**row, "jobStatus": "deleted" if row.get("jobStatus") == "deleted" else "active"} for row in applications]
            return _json(200, {"applications": applications})

        if method == "POST" and path == "/api/applications":
            email = await runtime.require_auth_email(request)
            body = await runtime.read_json_body(request)
            db = ctx.load_db()
            record = {
                **body,
                "id": body.get("id") or secrets.token_hex(6),
                "appliedAt": body.get("appliedAt") or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                "status": body.get("status") or "Applied",
            }
            db.setdefault("applications", {}).setdefault(email, [])
            idx = next((i for i, a in enumerate(db["applications"][email]) if a.get("id") == record["id"]), -1)
            if idx >= 0:
                db["applications"][email][idx] = {**db["applications"][email][idx], **record}
            else:
                db["applications"][email].insert(0, record)
            if config.database_url:
                await asyncio.to_thread(db_store.upsert_job_application_record, config.database_url, email, record)
            await ctx.save_db(db)
            return _json(201, {"applications": db["applications"][email], "application": record})

        if method == "GET" and path == "/api/talent/search":
            email = await runtime.require_auth_email(request)
            db = ctx.load_db()
            user = next((u for u in db.get("users") or [] if u.get("email") == email), None)
            if not user or user.get("role") != "employer":
                return _json(403, {"error": "Employer account required for talent search."})
            tenant = runtime.tenant_context_for_user(db, user)
            if not tenant.get("organization", {}).get("id"):
                return _json(403, {"error": "No organization linked to this employer account."})
            params = request.query_params
            skills = [s.strip() for s in str(params.get("skills") or "").split(",") if s.strip()]
            min_score_raw = params.get("minScore")
            try:
                result = await search_candidate_talent(
                    config.database_url,
                    tenant["organization"]["id"],
                    {
                        "q": params.get("q") or "",
                        "location": params.get("location") or "",
                        "experienceYears": params.get("experienceYears") or params.get("experience") or "",
                        "skills": skills,
                        "minScore": float(min_score_raw) if min_score_raw else None,
                        "limit": int(params.get("limit") or 25),
                        "offset": int(params.get("offset") or 0),
                    },
                )
                return _json(200, result)
            except Exception as err:
                return _json(500, {"error": str(err)})

        if method == "POST" and path == "/api/interview/transcribe":
            await runtime.require_auth_email(request)
            return _json(
                410,
                {
                    "error": "Server-side transcription was removed. The interview app uses on-device Moonshine STT (Silero VAD + WASM).",
                },
            )

        if method == "GET" and path == "/api/interview/flow":
            return _json(200, {"flow": ia.get_interview_interactive_flow_json()})

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
                account = next((u for u in db.get("users") or [] if u.get("email") == email), None)
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
                prev = dict((db.get("profiles") or {}).get(email) or {})
                db.setdefault("profiles", {})[email] = {
                    **prev,
                    **profile_patch,
                    "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                }
                await ctx.save_db(db)
                return _json(200, {"ok": True, **uploaded})
            except Exception as err:
                status = getattr(err, "status", 502)
                if getattr(err, "skipped", False):
                    return _json(status, {"error": str(err), "skipped": True})
                return _json(status, {"error": public_object_storage_error(err, "Resume upload failed. Please try again.")})

        if method == "GET" and path == "/api/resume/download":
            email = await runtime.require_auth_email(request)
            try:
                db = ctx.load_db()
                profile = (db.get("profiles") or {}).get(email) or {}
                pool = db_store.db_pool(config.database_url)
                signed = await resolve_resume_download_for_user(requesterEmail=email, profile=profile, pool=pool)
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
            lst = [c for c in db.get("confidentialVault") or [] if c.get("organizationId") == vault_tenant_id]
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
            profile = runtime.merge_interview_profile(db, email, body.get("profile"))
            account = next((u for u in db.get("users") or [] if u.get("email") == email), None)
            digest = ia.summarize_profile(profile, account.get("name") if account else None)
            history = runtime.merge_turn_into_interview_history(
                body.get("history") or session.get("history") or [], body.get("lastQuestion"), body.get("lastAnswer")
            )
            session["history"] = history
            total_turns = session.get("totalTurns") or ia.INTERVIEW_TURN_COUNT
            if len(history) >= total_turns:
                await ctx.save_db(db)
                return _json(200, {"complete": True, "turn": len(history)})
            client_question = body.get("question")
            if isinstance(client_question, dict) and client_question.get("text"):
                nxt = client_question
            else:
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
                    }
                )
            session.setdefault("questions", []).append(nxt)
            db["interviewSessions"][session_id] = session
            await ctx.save_db(db)
            return _json(200, {"question": nxt, "turn": len(history) + 1})

        if method == "POST" and path == "/api/interview/turn":
            email = await runtime.require_auth_email(request)
            body = await runtime.read_json_body(request)
            db = ctx.load_db()
            profile = runtime.merge_interview_profile(db, email, body.get("profile"))
            digest = ia.summarize_profile(profile, next((u.get("name") for u in db.get("users") or [] if u.get("email") == email), None))
            turn = await ia.generate_interview_turn(
                {
                    "ctx": digest,
                    "profile": profile,
                    "role": body.get("role") or "Full Stack Engineer",
                    "level": body.get("level") or "1–3 years",
                    "question": body.get("question") or {},
                    "answer": str(body.get("answer") or ""),
                    "questionIndex": int(body.get("questionIndex") or 0),
                    "totalQuestions": int(body.get("totalQuestions") or 0),
                    "nextQuestion": body.get("nextQuestion") or {},
                }
            )
            return _json(200, turn)

        if method == "POST" and path == "/api/interview/interact":
            email = await runtime.require_auth_email(request)
            body = await runtime.read_json_body(request)
            db = ctx.load_db()
            profile = runtime.merge_interview_profile(db, email, body.get("profile"))
            account = next((u for u in db.get("users") or [] if u.get("email") == email), None)
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
            face_count = int(body.get("faceCount") if body.get("faceCount") is not None else 1)
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
            email = await runtime.require_auth_email(request)
            body = await runtime.read_json_body(request)
            db = ctx.load_db()
            db.setdefault("interviews", {})[email] = body
            await ctx.save_db(db)
            return _json(200, {"interview": body})

        if method == "DELETE" and path.startswith("/api/applications/"):
            email = await runtime.require_auth_email(request)
            app_id = path.replace("/api/applications/", "").split("/")[0]
            if not app_id:
                return _json(400, {"error": "Application id required."})
            db = ctx.load_db()
            lst = [a for a in (db.get("applications") or {}).get(email) or [] if str(a.get("id")) != app_id]
            db.setdefault("applications", {})[email] = lst
            if config.database_url:
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
            body = await runtime.read_json_body(request)
            file_data = body.get("fileData") or body.get("fileBase64")
            file_name = str(body.get("fileName") or "resume.pdf")
            text = str(body.get("text") or body.get("resumeText") or "").strip()
            client_extracted = len(text) >= 40
            paddle_extract = None
            if not client_extracted and file_data:
                import base64

                b64 = file_data.split(",", 1)[1] if "," in str(file_data) else str(file_data)
                paddle_extract = await _run_paddle(base64.b64decode(b64), file_name)
            if paddle_extract:
                return _json(200, {"ok": True, "source": "paddle-ocr", "extract": paddle_extract})
            if text:
                parsed = await ia.parse_resume_with_ai(text)
                if parsed:
                    return _json(200, {"ok": True, "source": "local", "extract": parsed})
            return _json(400, {"ok": False, "error": "Could not extract fields from resume."})

        if method == "POST" and path == "/api/resume/replace":
            email = await runtime.require_auth_email(request)
            if not ctx.rate_limit(f"resume-replace:{email}", 8, 60_000):
                return _json(429, {"error": "Too many resume updates. Try again shortly."})
            body = await runtime.read_json_body(request)
            try:
                db = ctx.load_db()
                result = await replace_candidate_resume(config=config, email=email, body=body, db=db, save_db=ctx.save_db)
                return _json(200, {"ok": True, **result})
            except Exception as err:
                mapped = public_replace_resume_error(err)
                return _json(mapped["status"], mapped["body"])

        if method == "GET" and path == "/api/interview/recordings/playback":
            email = await runtime.require_auth_email(request)
            session_id = str(request.query_params.get("sessionId") or "").strip()
            if not session_id:
                return _json(400, {"error": "sessionId is required."})
            if not s3_storage_configured():
                return _json(503, {"error": "Recording storage is not configured (S3).", "skipped": True})
            if not config.database_url:
                return _json(503, {"error": "Database required for interview recordings."})
            try:
                db = ctx.load_db()
                pool = db_store.db_pool(config.database_url)
                signed = await rec_store.resolve_candidate_interview_recording_playback(
                    pool=pool,
                    db=db,
                    requesterEmail=email,
                    sessionId=session_id,
                )
                return _json(
                    200,
                    {
                        "playbackUrl": signed["url"],
                        "viewUrl": signed["url"],
                        "expiresInSeconds": signed["expiresInSeconds"],
                        "contentType": signed["contentType"],
                        "durationSeconds": signed.get("durationSeconds"),
                        "sessionId": session_id,
                    },
                )
            except rec_store.StorageError as err:
                body: dict[str, Any] = {"error": str(err)}
                if getattr(err, "skipped", False):
                    body["skipped"] = True
                return _json(err.status, body)
            except NotImplementedError as err:
                return _json(501, {"error": str(err)})

        if method == "POST" and path == "/api/interview/recordings/upload":
            email = await runtime.require_auth_email(request)
            if not s3_storage_configured():
                return _json(503, {"error": "Recording storage is not configured (S3).", "skipped": True})
            if not config.database_url:
                return _json(503, {"error": "Database required for interview recordings."})
            form = await request.form()
            upload = form.get("file")
            if upload is None or not hasattr(upload, "read"):
                return _json(400, {"error": "Recording file is required."})
            data = await upload.read()
            filename = str(form.get("filename") or getattr(upload, "filename", "") or "interview_recording.webm")
            content_type = str(getattr(upload, "content_type", "") or form.get("contentType") or "")
            duration_raw = form.get("durationSeconds")
            try:
                duration_seconds = int(float(duration_raw)) if duration_raw not in (None, "") else None
            except (TypeError, ValueError):
                duration_seconds = None
            try:
                db = ctx.load_db()
                account = next((u for u in db.get("users") or [] if u.get("email") == email), None)
                pool = db_store.db_pool(config.database_url)
                out = await rec_store.store_interview_recording_bytes(
                    pool=pool,
                    db=db,
                    requesterEmail=email,
                    account=account,
                    sessionId=str(form.get("sessionId") or ""),
                    filename=filename,
                    contentType=content_type,
                    data=data,
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
            if not config.database_url:
                return _json(503, {"error": "Database required for interview recordings."})
            body = await runtime.read_json_body(request)
            try:
                db = ctx.load_db()
                account = next((u for u in db.get("users") or [] if u.get("email") == email), None)
                pool = db_store.db_pool(config.database_url)
                out = await rec_store.authorize_interview_recording_upload(
                    pool=pool,
                    db=db,
                    requesterEmail=email,
                    account=account,
                    sessionId=str(body.get("sessionId") or ""),
                    filename=str(body.get("filename") or "interview_recording.webm"),
                    contentType=str(body.get("contentType") or ""),
                    fileSize=float(body.get("fileSize") or 0),
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
            if not config.database_url:
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
            if not config.database_url:
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
            resume_text = ctx_json.get("resumeText") or (app or {}).get("data", {}).get("resumeText") or (db.get("profiles") or {}).get(row.get("candidate_email"), {}).get("resumeText") or ""
            job_description = ctx_json.get("jobDescription") or (job or {}).get("jobDescription") or (app or {}).get("data", {}).get("jobDescription") or ""
            return _json(
                200,
                {
                    "invite": {
                        "token": row.get("token"),
                        "serverNow": server_now.isoformat().replace("+00:00", "Z"),
                        "candidateEmail": row.get("candidate_email"),
                        "candidateName": row.get("candidate_name"),
                        "jobTitle": row.get("job_title") or (job or {}).get("title") or ctx_json.get("jobTitle"),
                        "scheduledStart": row.get("scheduled_start"),
                        "scheduledEnd": row.get("scheduled_end"),
                        "applicationId": row.get("application_id"),
                        "jobId": row.get("job_id"),
                        "organizationId": org_id,
                        "jobDescription": job_description,
                        "resumeText": resume_text,
                        "resumeName": ctx_json.get("resumeName") or (app or {}).get("data", {}).get("resumeName"),
                        "roleTrack": ctx_json.get("roleTrack") or (job or {}).get("roleTrack") or "",
                        "experienceLevel": ctx_json.get("experienceLevel") or (job or {}).get("experienceLevel") or "",
                        "company": (job or {}).get("company") or "",
                        "primarySkills": ctx_json.get("primarySkills") or (app or {}).get("data", {}).get("primarySkills") or (job or {}).get("requiredSkills") or [],
                        "atsScore": (app or {}).get("data", {}).get("atsScore"),
                        "jdMatchScore": (app or {}).get("data", {}).get("jdMatchScore"),
                        "contextSource": ctx_json.get("source"),
                        "status": access.get("status"),
                        "canStart": access.get("canStart"),
                        "interviewPath": f"/interview/invite/{row.get('token')}",
                    }
                },
            )

        if method == "GET" and path.startswith("/api/talent/candidates/"):
            email = await runtime.require_auth_email(request)
            db = ctx.load_db()
            user = next((u for u in db.get("users") or [] if u.get("email") == email), None)
            if not user or user.get("role") != "employer":
                return _json(403, {"error": "Employer account required."})
            tenant = runtime.tenant_context_for_user(db, user)
            user_id = path.replace("/api/talent/candidates/", "").split("/")[0]
            candidate = await get_candidate_talent_by_id(config.database_url, tenant["organization"]["id"], user_id)
            if not candidate:
                return _json(404, {"error": "Candidate not found or not visible."})
            return _json(200, {"candidate": candidate, "interview": (db.get("interviews") or {}).get(candidate["email"])})

    except HTTPException as exc:
        return _json(exc.status_code, {"error": exc.detail})
    except NotImplementedError as exc:
        return _json(501, {"error": str(exc)})
    except Exception:
        return _json(500, {"error": "Server error"})

    from app.dispatch.route_extensions import try_extended_routes

    ext = await try_extended_routes(request, ctx, vault_tenant_id, _json, _vendor_recruiter_scope)
    if ext is not None:
        return ext

    return None
