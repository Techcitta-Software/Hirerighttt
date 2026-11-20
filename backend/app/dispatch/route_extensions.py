"""Routes ported from legacy apiDispatch.mjs not yet inlined in api_dispatch.py."""

from __future__ import annotations

import asyncio

from app.db.finders import find_user, memberships_for_user, remove_vault_item, vault_for_org
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from fastapi import Request
from fastapi.responses import JSONResponse, RedirectResponse, Response

from app.db import dynamo_repos as dr
from app.db import store as db_store
from app.db.dynamo_config import database_provider, persistence_ready
from app.db.row_utils import row_value
from app.dispatch.context import DispatchContext
from app.node_config import config
from app.server import runtime
from app.services.interview_invites import (
    DEFAULT_OPEN_INVITE_DAYS,
    INVITE_JOIN_WINDOW_MINUTES,
    build_interview_invite_email,
    insert_interview_invite,
    invite_join_window_end,
    invite_public_url,
    new_invite_token,
    send_interview_invite_email,
)
from app.services import audit
from app.services.interview_review import vendor_may_view_interview_session
from app.services.mail_service import send_mail, smtp_configured
from app.services.storage import interview_artifact_storage as art_store
from app.services.storage import interview_recording_storage as rec_store
from app.services.storage.s3_storage import s3_storage_configured
from app.services.vendor.candidate_documents import assert_vendor_may_view_candidate_documents
from app.services.vendor.jobs import get_org_application_for_recruiter, get_org_job_for_recruiter


import logging
import os

logger = logging.getLogger("hireright.invites")

MAIL_SEND_FAILED = "The email could not be sent. Share the link manually."


def _invite_daily_recipient_limit() -> int:
    """V-10: interview emails an organization may send per day (employer signup is unverified, so the mailbox could
    otherwise be used as a spam / phishing relay)."""
    try:
        return max(1, int(os.environ.get("INVITE_DAILY_RECIPIENT_LIMIT") or 50))
    except ValueError:
        return 50


def _mark_invite_email_sent(pool, token: str) -> None:
    """Blocking (run via asyncio.to_thread)."""
    if database_provider() == "dynamodb":
        dr.update_invite_email_sent_dynamo(token)
        return
    with pool.connection() as conn:
        conn.execute("UPDATE interview_invites SET email_sent_at = NOW() WHERE token = %s", (token,))
        conn.commit()


def _load_session_row(pool, session_id: str):
    """Blocking (run via asyncio.to_thread)."""
    with pool.connection() as conn:
        return conn.execute("SELECT email, data FROM interview_sessions WHERE session_id = %s", (session_id,)).fetchone()


async def try_extended_routes(
    request: Request,
    ctx: DispatchContext,
    vault_tenant_id: str | None,
    json_fn: Callable[..., JSONResponse],
    vendor_scope,
) -> Response | None:
    path = request.url.path
    method = request.method.upper()

    # --- Confidential vault (beyond GET list in main dispatch) ---
    if vault_tenant_id and path.startswith("/api/confidential/"):
        db = ctx.load_db()
        if method == "POST" and path == "/api/confidential/candidates":
            body = await runtime.read_json_body(request)
            if not body.get("name") and not body.get("email"):
                return json_fn(400, {"error": "Candidate name or email is required."})
            db.setdefault("confidentialVault", [])
            candidate = {
                "id": f"conf-{secrets.token_hex(6)}",
                "organizationId": vault_tenant_id,
                "name": str(body.get("name") or "Anonymous Candidate"),
                "email": str(body.get("email") or f"candidate_{int(datetime.now().timestamp() * 1000)}@confidential.io"),
                "phone": str(body.get("phone") or ""),
                "currentRole": str(body.get("currentRole") or ""),
                "experienceYears": str(body.get("experienceYears") or ""),
                "location": str(body.get("location") or ""),
                "skills": body.get("skills") if isinstance(body.get("skills"), list) else [],
                "resumeName": str(body.get("resumeName") or "candidate_resume.pdf"),
                "resumeText": str(body.get("resumeText") or ""),
                "summary": str(body.get("summary") or str(body.get("resumeText") or "")[:160]),
                "interviewScore": body.get("interviewScore") if isinstance(body.get("interviewScore"), (int, float)) else None,
                "interviewResult": body.get("interviewResult"),
                "status": body.get("status") or "New",
                "source": str(body.get("source") or "Confidential Ingestion API"),
                "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            }
            db["confidentialVault"].insert(0, candidate)
            await ctx.save_db(db)
            return json_fn(201, {"success": True, "candidate": candidate})

        if method == "GET" and path.startswith("/api/confidential/candidates/") and path != "/api/confidential/candidates/":
            cid = path.replace("/api/confidential/candidates/", "").strip("/")
            item = next((c for c in vault_for_org(db, vault_tenant_id) if c.get("id") == cid), None)
            if not item:
                return json_fn(404, {"error": "Confidential candidate not found."})
            return json_fn(200, {"candidate": item})

        if method == "PUT" and "/status" in path and path.startswith("/api/confidential/candidates/"):
            cid = path.split("/")[4]
            body = await runtime.read_json_body(request)
            vault = vault_for_org(db, vault_tenant_id)
            idx = next((i for i, c in enumerate(vault) if c.get("id") == cid and c.get("organizationId") == vault_tenant_id), -1)
            if idx < 0:
                return json_fn(404, {"error": "Confidential candidate not found."})
            if body.get("status"):
                vault[idx]["status"] = str(body["status"])
            await ctx.save_db(db)
            return json_fn(200, {"success": True, "candidate": vault[idx]})

        if method == "DELETE" and path.startswith("/api/confidential/candidates/"):
            cid = path.replace("/api/confidential/candidates/", "").strip("/")
            for c in [c for c in vault_for_org(db, vault_tenant_id) if c.get("id") == cid]:
                remove_vault_item(db, c)
            await ctx.save_db(db)
            return json_fn(200, {"success": True, "deletedId": cid})

        if method == "GET" and path == "/api/confidential/export":
            lst = vault_for_org(db, vault_tenant_id)
            return json_fn(200, {"exportedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "total": len(lst), "candidates": lst})

        if method == "GET" and path == "/api/confidential/stats":
            lst = vault_for_org(db, vault_tenant_id)
            scored = [c for c in lst if isinstance(c.get("interviewScore"), (int, float))]
            avg = round(sum(c["interviewScore"] for c in scored) / len(scored)) if scored else 0
            return json_fn(
                200,
                {
                    "totalCandidates": len(lst),
                    "resumesParsed": sum(1 for c in lst if c.get("resumeText")),
                    "interviewsCompleted": len(scored),
                    "averageTalentScore": avg,
                },
            )

    if method == "PATCH" and path.startswith("/api/vendor/applicants/") and path.count("/") == 4:
        db = ctx.load_db()
        access = await runtime.require_employer_tenant(request, db)
        if not access:
            return None
        app_id = path.replace("/api/vendor/applicants/", "").split("/")[0]
        body = await runtime.read_json_body(request)
        app = get_org_application_for_recruiter(db, access["tenant"]["organization"]["id"], app_id, vendor_scope(access))
        if not app:
            return json_fn(404, {"error": "Applicant not found."})
        if body.get("status"):
            app["status"] = str(body["status"])
        await ctx.save_db(db)
        return json_fn(200, {"application": app})

    if method == "POST" and re.match(r"^/api/vendor/applicants/[^/]+/interview-invite$", path):
        db = ctx.load_db()
        access = await runtime.require_employer_tenant(request, db)
        if not access:
            return None
        if not persistence_ready(config.database_url):
            return json_fn(503, {"error": "Database required for interview invites."})
        app_id = path.split("/")[4]
        body = await runtime.read_json_body(request)
        org_id = access["tenant"]["organization"]["id"]
        if not ctx.rate_limit(f"invite-app:{org_id}", 100, 86_400_000):
            return json_fn(429, {"error": "Daily interview-invite limit reached for your organization. Try again tomorrow."})
        app = await asyncio.to_thread(get_org_application_for_recruiter, db, org_id, app_id, vendor_scope(access))
        if not app:
            return json_fn(404, {"error": "Applicant not found."})
        job = await asyncio.to_thread(get_org_job_for_recruiter, db, org_id, app.get("jobId"), vendor_scope(access))
        start_raw = body.get("scheduledStart") or body.get("scheduledAt")
        try:
            start = datetime.fromisoformat(str(start_raw).replace("Z", "+00:00"))
        except Exception:
            return json_fn(400, {"error": "scheduledStart (ISO datetime) is required."})
        duration = float(body.get("durationMinutes") or 60)
        if duration < 15 or duration > 180:
            return json_fn(400, {"error": "Duration must be between 15 and 180 minutes."})
        if start.timestamp() <= datetime.now(timezone.utc).timestamp():
            return json_fn(400, {"error": "Choose a future interview time."})
        end = invite_join_window_end(start)
        token = new_invite_token()
        invite_url = invite_public_url(token)
        context_json = {
            **runtime.build_employer_invite_context(db, app, job),
            "interviewDurationMinutes": int(duration),
            "joinWindowMinutes": INVITE_JOIN_WINDOW_MINUTES,
        }
        pool = db_store.db_pool(config.database_url or "dynamodb")
        await insert_interview_invite(
            pool,
            {
                "token": token,
                "organizationId": org_id,
                "applicationId": app.get("id"),
                "jobId": app.get("jobId"),
                "candidateEmail": app.get("candidateEmail"),
                "candidateName": (app.get("data") or {}).get("candidateName") or "",
                "jobTitle": (job or {}).get("title") or (app.get("data") or {}).get("jobTitle") or "",
                "scheduledStart": start.isoformat().replace("+00:00", "Z"),
                "scheduledEnd": end.isoformat().replace("+00:00", "Z"),
                "createdByUserId": access["user"].get("id"),
                "contextJson": context_json,
            },
        )
        email_sent = False
        email_error = None
        if smtp_configured():
            try:
                await send_interview_invite_email(
                    to=app["candidateEmail"],
                    candidateName=(app.get("data") or {}).get("candidateName"),
                    jobTitle=(job or {}).get("title"),
                    scheduledStart=start.isoformat().replace("+00:00", "Z"),
                    scheduledEnd=end.isoformat().replace("+00:00", "Z"),
                    durationMinutes=int(duration),
                    inviteUrl=invite_url,
                )
                await asyncio.to_thread(_mark_invite_email_sent, pool, token)
                email_sent = True
            except Exception:
                logger.warning("Interview invite email failed", exc_info=True)
                email_error = MAIL_SEND_FAILED
        app.setdefault("data", {})["lastInterviewInvite"] = {
            "token": token,
            "inviteUrl": invite_url,
            "scheduledStart": start.isoformat().replace("+00:00", "Z"),
            "scheduledEnd": end.isoformat().replace("+00:00", "Z"),
            "emailSent": email_sent,
        }
        await ctx.save_db(db)
        return json_fn(
            201,
            {
                "invite": {
                    "token": token,
                    "inviteUrl": invite_url,
                    "scheduledStart": start.isoformat().replace("+00:00", "Z"),
                    "scheduledEnd": end.isoformat().replace("+00:00", "Z"),
                    "emailSent": email_sent,
                    "emailError": email_error,
                    "smtpConfigured": smtp_configured(),
                }
            },
        )

    if method == "POST" and path == "/api/vendor/interview-invites/send":
        # Recruiter sends an open interview link to one or many people. The link works any time until it expires,
        # then takes the candidate straight into an interview built from their own resume.
        db = ctx.load_db()
        access = await runtime.require_employer_tenant(request, db)
        if not access:
            return None
        if not persistence_ready(config.database_url):
            return json_fn(503, {"error": "Database required for interview invites."})
        if not ctx.rate_limit(f"invite-send:{access['user'].get('email')}", 20, 3_600_000):
            return json_fn(429, {"error": "Invite limit reached for this hour. Try again later."})
        invite_org_id = access["tenant"]["organization"]["id"]
        body = await runtime.read_json_body(request)
        raw_people = body.get("candidates")
        if not isinstance(raw_people, list):
            raw_people = [{"email": body.get("email"), "name": body.get("name")}]
        people: list[tuple[str, str]] = []
        seen: set[str] = set()
        for item in raw_people[:50]:
            if not isinstance(item, dict):
                continue
            em = str(item.get("email") or "").strip().lower()
            if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", em) or em in seen:
                continue
            seen.add(em)
            people.append((em, str(item.get("name") or "").strip()[:120]))
        if not people:
            return json_fn(400, {"error": "Provide at least one valid candidate email."})
        # V-10: every recipient counts against the organization's daily allowance (default 50 / day).
        allowed_people = []
        for person in people:
            if not ctx.rate_limit(f"invite-recipients:{invite_org_id}", _invite_daily_recipient_limit(), 86_400_000):
                break
            allowed_people.append(person)
        if not allowed_people:
            return json_fn(429, {"error": "Daily invite limit reached for your organization. Try again tomorrow."})
        skipped_over_limit = [em for em, _ in people[len(allowed_people):]]
        people = allowed_people
        audit.fire(
            audit.INVITE_CREATED,
            user_id=(access.get("user") or {}).get("id"),
            organization_id=invite_org_id,
            entity_type="interview_invite",
            entity_id="",
            meta={"recipients": [audit.email_fingerprint(em) for em, _ in people], "skipped": len(skipped_over_limit)},
        )
        try:
            days = int(body.get("expiresInDays") or DEFAULT_OPEN_INVITE_DAYS)
        except (TypeError, ValueError):
            days = DEFAULT_OPEN_INVITE_DAYS
        days = max(1, min(30, days))
        org = access["tenant"]["organization"]
        org_id = org["id"]
        job = None
        if body.get("jobId"):
            job = get_org_job_for_recruiter(db, org_id, str(body["jobId"]), vendor_scope(access))
            if not job:
                return json_fn(404, {"error": "Job not found."})
        job_title = re.sub(r"[\r\n<>]+", " ", str(body.get("jobTitle") or (job or {}).get("title") or "AI Interview"))[:160]
        now = datetime.now(timezone.utc)
        start = now - timedelta(minutes=1)
        end = now + timedelta(days=days)
        pool = db_store.db_pool(config.database_url or "dynamodb")
        results = []
        for em, nm in people:
            token = new_invite_token()
            invite_url = invite_public_url(token)
            context_json = {
                **runtime.build_job_seeker_invite_context(db, em, body),
                "source": "employer",
                "jobDescription": str((job or {}).get("jobDescription") or body.get("jobDescription") or "")[:80000],
                "roleTrack": (job or {}).get("roleTrack") or body.get("roleTrack") or "",
                "experienceLevel": (job or {}).get("experienceLevel") or body.get("experienceLevel") or "",
                "primarySkills": (job or {}).get("requiredSkills") or body.get("primarySkills") or [],
                "jobTitle": job_title,
                "interviewDurationMinutes": 20,
                "openInvite": True,
            }
            await insert_interview_invite(
                pool,
                {
                    "token": token,
                    "organizationId": org_id,
                    "jobId": (job or {}).get("id"),
                    "candidateEmail": em,
                    "candidateName": nm,
                    "jobTitle": job_title,
                    "scheduledStart": start.isoformat().replace("+00:00", "Z"),
                    "scheduledEnd": end.isoformat().replace("+00:00", "Z"),
                    "createdByUserId": access["user"].get("id"),
                    "contextJson": context_json,
                },
            )
            sent = False
            err_text = None
            if smtp_configured():
                try:
                    await send_interview_invite_email(
                        to=em,
                        candidateName=nm,
                        jobTitle=job_title,
                        company=org.get("name") or org.get("companyName") or "",
                        scheduledStart=start.isoformat().replace("+00:00", "Z"),
                        scheduledEnd=end.isoformat().replace("+00:00", "Z"),
                        durationMinutes=20,
                        inviteUrl=invite_url,
                        openInvite=True,
                    )
                    await asyncio.to_thread(_mark_invite_email_sent, pool, token)
                    sent = True
                except Exception:
                    logger.warning("Open invite email failed", exc_info=True)
                    err_text = MAIL_SEND_FAILED
            else:
                err_text = "Email is not configured on the server. Share the link manually."
            results.append({"email": em, "name": nm, "inviteUrl": invite_url, "emailSent": sent, "emailError": err_text})
        return json_fn(
            201,
            {
                "ok": True,
                "expiresAt": end.isoformat().replace("+00:00", "Z"),
                "smtpConfigured": smtp_configured(),
                "invites": results,
                "skippedOverDailyLimit": skipped_over_limit,
            },
        )

    if method == "POST" and path == "/api/interview/confirmation-email":
        email = await runtime.require_auth_email(request)
        if not ctx.rate_limit(f"confirm-mail:{email}", 10, 3_600_000):
            return json_fn(429, {"error": "Too many booking emails. Try again later."})
        body = await runtime.read_json_body(request)
        start_raw = body.get("scheduledStart") or body.get("scheduledAt")
        try:
            start = datetime.fromisoformat(str(start_raw).replace("Z", "+00:00"))
        except Exception:
            return json_fn(400, {"error": "scheduledStart is required."})
        if not smtp_configured():
            return json_fn(503, {"error": "SMTP not configured on server.", "smtpConfigured": False})
        if not persistence_ready(config.database_url):
            return json_fn(503, {"error": "Database required."})
        duration = float(body.get("durationMinutes") or 60)
        if duration < 15 or duration > 180:
            return json_fn(400, {"error": "Duration must be between 15 and 180 minutes."})
        if start.timestamp() <= datetime.now(timezone.utc).timestamp():
            return json_fn(400, {"error": "Choose a future interview time."})
        db = ctx.load_db()
        user = find_user(db, email=email)
        end = invite_join_window_end(start)
        token = new_invite_token()
        invite_url = invite_public_url(token)
        org_id = user.get("primaryOrganizationId") if user else None
        if not org_id:
            member = next(iter(memberships_for_user(db, user.get("id") if user else None)), None)
            org_id = member.get("organizationId") if member else None
        context_json = {
            **runtime.build_job_seeker_invite_context(db, email, body),
            "interviewDurationMinutes": int(duration),
            "joinWindowMinutes": INVITE_JOIN_WINDOW_MINUTES,
        }
        pool = db_store.db_pool(config.database_url or "dynamodb")
        await insert_interview_invite(
            pool,
            {
                "token": token,
                "organizationId": org_id,
                "candidateEmail": email,
                "candidateName": user.get("name") if user else "",
                "jobTitle": body.get("jobTitle") or context_json.get("jobTitle") or "AI Interview",
                "scheduledStart": start.isoformat().replace("+00:00", "Z"),
                "scheduledEnd": end.isoformat().replace("+00:00", "Z"),
                "createdByUserId": user.get("id") if user else None,
                "contextJson": context_json,
            },
        )
        mail = build_interview_invite_email(
            candidateName=user.get("name") if user else None,
            jobTitle=body.get("jobTitle") or context_json.get("jobTitle"),
            scheduledStart=start.isoformat().replace("+00:00", "Z"),
            scheduledEnd=end.isoformat().replace("+00:00", "Z"),
            durationMinutes=int(duration),
            inviteUrl=invite_url,
        )
        email_sent = False
        email_error = None
        try:
            await send_mail(to=email, subject=mail["subject"], html=mail["html"], text=mail.get("text"))
            await asyncio.to_thread(_mark_invite_email_sent, pool, token)
            email_sent = True
        except Exception:
            logger.warning("Booking confirmation email failed", exc_info=True)
            email_error = MAIL_SEND_FAILED
        return json_fn(
            200,
            {
                "ok": True,
                "inviteUrl": invite_url,
                "emailSent": email_sent,
                "emailError": email_error,
                "token": token,
                "scheduledStart": start.isoformat().replace("+00:00", "Z"),
                "scheduledEnd": end.isoformat().replace("+00:00", "Z"),
                "smtpConfigured": True,
            },
        )

    if method == "GET" and path == "/api/vendor/candidate-documents/recording":
        db = ctx.load_db()
        access = await runtime.require_employer_tenant(request, db)
        if not access:
            return None
        candidate_email = str(request.query_params.get("email") or "").strip()
        session_id = str(request.query_params.get("sessionId") or request.query_params.get("interviewId") or "").strip()
        try:
            assert_vendor_may_view_candidate_documents(db, access["tenant"]["organization"]["id"], candidate_email, vendor_scope(access))
            pool = db_store.db_pool(config.database_url or "dynamodb")
            signed = await rec_store.resolve_employer_candidate_recording_playback(
                pool=pool,
                db=db,
                organizationId=access["tenant"]["organization"]["id"],
                candidateEmail=candidate_email,
                interviewId=session_id or None,
                recruiterScope=vendor_scope(access),
            )
            audit.fire(
                audit.RECORDING_VIEWED,
                user_id=(access.get("user") or {}).get("id"),
                organization_id=access["tenant"]["organization"]["id"],
                entity_type="interview",
                entity_id=str(signed.get("interviewId") or session_id or ""),
                meta={"candidate_fp": audit.email_fingerprint(candidate_email)},
            )
            return json_fn(
                200,
                {
                    "playbackUrl": signed["url"],
                    "viewUrl": signed["url"],
                    "downloadUrl": signed["url"],
                    "expiresInSeconds": signed["expiresInSeconds"],
                    "contentType": signed["contentType"],
                    "filename": signed.get("filename"),
                    "sessionId": signed.get("interviewId"),
                    "candidateEmail": candidate_email.lower(),
                    "durationSeconds": signed.get("durationSeconds"),
                    "fileSizeBytes": signed.get("fileSizeBytes"),
                },
            )
        except rec_store.StorageError as err:
            return json_fn(err.status, {"error": str(err)})
        except ValueError as err:  # access rule refused (e.g. no link between this organization and the candidate)
            return json_fn(getattr(err, "status", 404), {"error": str(err)})

    if method == "GET" and path == "/api/vendor/candidate-documents/report":
        db = ctx.load_db()
        access = await runtime.require_employer_tenant(request, db)
        if not access:
            return None
        candidate_email = str(request.query_params.get("email") or "").strip()
        try:
            assert_vendor_may_view_candidate_documents(db, access["tenant"]["organization"]["id"], candidate_email, vendor_scope(access))
            pool = db_store.db_pool(config.database_url or "dynamodb")
            signed = await art_store.resolve_candidate_interview_report_download(pool=pool, candidateEmail=candidate_email, inline=True)
            return json_fn(
                200,
                {
                    "viewUrl": signed["url"],
                    "downloadUrl": signed["url"],
                    "expiresInSeconds": signed["expiresInSeconds"],
                    "contentType": signed["contentType"],
                    "filename": signed.get("filename"),
                    "sessionId": signed.get("sessionId"),
                },
            )
        except art_store.ArtifactStorageError as err:
            return json_fn(err.status, {"error": str(err)})
        except ValueError as err:
            return json_fn(getattr(err, "status", 404), {"error": str(err)})

    if method == "GET" and path == "/api/vendor/interview-review":
        db = ctx.load_db()
        access = await runtime.require_employer_tenant(request, db)
        if not access:
            return None
        user = access["user"]
        tenant = access["tenant"]
        if user.get("status") == "disabled" or tenant["organization"].get("status") != "active":
            return json_fn(403, {"error": "Reviewer access required."})
        if (tenant.get("membership") or {}).get("role") not in ("owner", "admin", "recruiter"):
            return json_fn(403, {"error": "Reviewer access required."})
        session_id = str(request.query_params.get("sessionId") or "").strip()
        candidate_email = str(request.query_params.get("email") or "").strip().lower()
        if not session_id or not candidate_email:
            return json_fn(400, {"error": "sessionId and email are required."})
        org_id = tenant["organization"]["id"]
        try:
            await asyncio.to_thread(assert_vendor_may_view_candidate_documents, db, org_id, candidate_email, vendor_scope(access))
        except ValueError as err:
            return json_fn(getattr(err, "status", 404), {"error": str(err)})
        session = (db.get("interviewSessions") or {}).get(session_id)
        if not session and database_provider() == "dynamodb":
            session = dr.get_interview_session_data_dynamo(session_id)
            if session:
                db.setdefault("interviewSessions", {})[session_id] = session
        elif not session and persistence_ready(config.database_url):
            pool = db_store.db_pool(config.database_url or "dynamodb")
            row = await asyncio.to_thread(_load_session_row, pool, session_id)
            if row:
                session = row_value(row, "data", 1) or {}
                session.setdefault("email", row_value(row, "email", 0))
                db.setdefault("interviewSessions", {})[session_id] = session
        if not session or not vendor_may_view_interview_session(session, org_id, candidate_email):
            return json_fn(404, {"error": "Interview not found for this candidate."})
        video_url = None
        recording_status = "No recording available"
        if persistence_ready(config.database_url) and s3_storage_configured():
            try:
                pool = db_store.db_pool(config.database_url or "dynamodb")
                signed = await rec_store.resolve_employer_candidate_recording_playback(
                    pool=pool,
                    db=db,
                    organizationId=org_id,
                    candidateEmail=candidate_email,
                    interviewId=session_id,
                    recruiterScope=vendor_scope(access),
                )
                video_url = signed["url"]
                recording_status = "Recording available"
                audit.fire(
                    audit.RECORDING_VIEWED,
                    user_id=(access.get("user") or {}).get("id"),
                    organization_id=org_id,
                    entity_type="interview",
                    entity_id=str(session_id or ""),
                    meta={"candidate_fp": audit.email_fingerprint(candidate_email)},
                )
            except Exception:
                pass
        stored = (db.get("interviews") or {}).get(candidate_email)
        proctoring = ((session.get("result") or {}).get("integrity") or {}).get("proctoring") or (stored or {}).get("integrity", {}).get("proctoring")
        return json_fn(
            200,
            {
                "events": session.get("reviewEvents") or [],
                "proctoring": proctoring,
                "videoUrl": video_url,
                "recordingStatus": recording_status,
                "sessionId": session_id,
                "candidateEmail": candidate_email,
            },
        )

    if method == "GET" and path.startswith("/api/interview/recordings/") and path.endswith("/download"):
        db = ctx.load_db()
        access = await runtime.require_employer_tenant(request, db)
        if not access:
            return None
        if (access["tenant"].get("membership") or {}).get("role") not in ("owner", "admin", "recruiter"):
            return json_fn(403, {"error": "Reviewer access required."})
        recording_id = path.replace("/api/interview/recordings/", "").replace("/download", "").strip()
        try:
            pool = db_store.db_pool(config.database_url or "dynamodb")
            signed = await rec_store.resolve_interview_recording_download(
                pool=pool,
                requesterEmail=access["user"]["email"],
                tenantId=access["tenant"]["organization"]["id"],
                recordingId=recording_id,
            )
            if "application/json" in request.headers.get("accept", "") or request.query_params.get("format") == "json":
                return json_fn(200, {"downloadUrl": signed["url"], "expiresInSeconds": signed["expiresInSeconds"]})
            return RedirectResponse(signed["url"], status_code=302)
        except rec_store.StorageError as err:
            return json_fn(err.status, {"error": str(err)})

    if method == "POST" and path == "/api/interview/artifacts/report":
        email = await runtime.require_auth_email(request)
        body = await runtime.read_json_body(request)
        try:
            db = ctx.load_db()
            account = find_user(db, email=email)
            pool = db_store.db_pool(config.database_url or "dynamodb")
            out = await art_store.persist_interview_report_pdf_to_s3(
                pool=pool,
                db=db,
                requesterEmail=email,
                account=account,
                sessionId=str(body.get("sessionId") or ""),
                fileBase64=str(body.get("file_base64") or ""),
            )
            return json_fn(200, {"ok": True, **out})
        except art_store.ArtifactStorageError as err:
            body_out: dict[str, Any] = {"error": str(err)}
            if err.skipped:
                body_out["skipped"] = True
            return json_fn(err.status, body_out)

    if method == "GET" and path.startswith("/api/interview/artifacts/"):
        email = await runtime.require_auth_email(request)
        parts = path.replace("/api/interview/artifacts/", "").split("/")
        session_id, artifact_type, action = parts[0] if parts else "", parts[1] if len(parts) > 1 else "", parts[2] if len(parts) > 2 else ""
        if not session_id or artifact_type not in ("transcript", "report") or action != "download":
            return json_fn(400, {"error": "Use /api/interview/artifacts/{sessionId}/transcript|report/download"})
        try:
            pool = db_store.db_pool(config.database_url or "dynamodb")
            signed = await art_store.resolve_interview_artifact_download(
                pool=pool,
                requesterEmail=email,
                sessionId=session_id,
                artifactType=artifact_type,
            )
            if "application/json" in request.headers.get("accept", "") or request.query_params.get("format") == "json":
                return json_fn(200, {"downloadUrl": signed["url"], "expiresInSeconds": signed["expiresInSeconds"]})
            return RedirectResponse(signed["url"], status_code=302)
        except art_store.ArtifactStorageError as err:
            return json_fn(err.status, {"error": str(err)})

    return None
