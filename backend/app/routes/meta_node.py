from __future__ import annotations

import os

from fastapi import APIRouter, HTTPException, Request

from app.server import runtime
from app.services.interview_invites import INVITE_JOIN_WINDOW_MINUTES
from app.services.interview_api import llm_configured
from app.services.mail_service import smtp_configured

router = APIRouter()


@router.get("/llm-status")
async def llm_status() -> dict:
    if not llm_configured():
        return {
            "active": False,
            "configured": False,
            "provider": "Built-in Local Agent",
            "message": "No LLM API key set. Running in local agent mode.",
        }
    return {
        "active": True,
        "configured": True,
        "provider": "HireRight AI",
        "model": "hireright-ai",
        "message": "Ava AI interview is ready.",
        "models": {
            "fast": os.environ.get("FAST_MODEL") or os.environ.get("PRIMARY_MODEL") or "gemini-3.1-flash-lite",
            "quality": os.environ.get("QUALITY_MODEL") or os.environ.get("PRIMARY_MODEL") or "gemini-3.1-flash-lite",
        },
    }


@router.get("/mail/status")
async def mail_status(request: Request) -> dict:
    verify_param = request.query_params.get("verify") == "1"
    verify = None
    if verify_param and smtp_configured():
        verify = {"ok": True}
    elif verify_param:
        verify = {
            "ok": False,
            "error": "Set RESEND_API_KEY + EMAIL_FROM (Render) or SMTP_EMAIL + SMTP_APP_PASSWORD (local)",
        }
    public_app_url = os.environ.get("VITE_PUBLIC_APP_URL") or os.environ.get("PUBLIC_APP_URL") or None
    return {
        "smtpConfigured": smtp_configured(),
        "mailProvider": "resend" if os.environ.get("RESEND_API_KEY") else ("gmail-smtp" if smtp_configured() else None),
        "smtpHost": "smtp.gmail.com" if os.environ.get("SMTP_EMAIL") else None,
        "smtpUser": os.environ.get("SMTP_EMAIL"),
        "smtpFrom": os.environ.get("EMAIL_FROM") or os.environ.get("SMTP_EMAIL"),
        "smtpPassSet": bool(os.environ.get("SMTP_APP_PASSWORD")),
        "resendKeySet": bool(os.environ.get("RESEND_API_KEY")),
        "publicAppUrl": public_app_url,
        "publicAppUrlError": None if public_app_url else "Set VITE_PUBLIC_APP_URL for production invite links.",
        "inviteJoinWindowMinutes": INVITE_JOIN_WINDOW_MINUTES,
        "verify": verify,
    }


@router.get("/plans")
async def plans() -> dict:
    db = runtime.load_db()
    public = [p for p in db.get("subscriptionPlans") or [] if p.get("isPublic") is not False]
    return {"plans": public}


@router.get("/organization")
async def organization(request: Request) -> dict:
    email = await runtime.require_auth_email(request)
    db = runtime.load_db()
    user = next((u for u in db.get("users") or [] if u.get("email") == email), None)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    tenant = runtime.tenant_context_for_user(db, user)
    org = tenant.get("organization")
    if not org:
        raise HTTPException(status_code=404, detail="No organization for this account.")
    org_id = org["id"]
    members = []
    for m in db.get("organizationMembers") or []:
        if m.get("organizationId") != org_id:
            continue
        u = next((x for x in db.get("users") or [] if x.get("id") == m.get("userId")), None)
        members.append(
            {
                "userId": m.get("userId"),
                "role": m.get("role"),
                "email": u.get("email") if u else None,
                "name": u.get("name") if u else None,
                "joinedAt": m.get("joinedAt"),
            }
        )
    jobs = [j for j in db.get("jobs") or [] if j.get("organizationId") == org_id]
    return {
        "organization": org,
        "subscription": tenant.get("subscription"),
        "plan": tenant.get("plan"),
        "members": members,
        "jobs": jobs,
    }
