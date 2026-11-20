from __future__ import annotations

from app.db.finders import find_user, find_users_by_ids, jobs_for_org, members_of_org
import os

from fastapi import APIRouter, HTTPException, Request

from app.server import runtime
from app.services.interview_invites import INVITE_JOIN_WINDOW_MINUTES
from app.services.interview_api import llm_configured
from app.services.mail_service import smtp_configured

router = APIRouter()


@router.get("/llm-status")
async def llm_status(request: Request) -> dict:
    from app.node_config import is_prod_like
    from app.services.gemini_client import status_snapshot, verify_keys

    from app.routes.health_node import health_detail_allowed

    detail: dict = {}
    if health_detail_allowed(request):  # V-20: key / failover state only for operators in production
        detail["failover"] = status_snapshot()
    # Live key check (one tiny request per key). Development only, so it cannot be used to burn quota in production.
    if request.query_params.get("verify") == "1" and not is_prod_like:
        detail["verify"] = await verify_keys()
    return {**(await _llm_status_core()), **detail}


async def _llm_status_core() -> dict:
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
    from app.routes.health_node import health_detail_allowed
    from app.services.mail_service import mail_provider

    public_app_url = os.environ.get("VITE_PUBLIC_APP_URL") or os.environ.get("PUBLIC_APP_URL") or None
    if not health_detail_allowed(request):
        # V-20: the public answer is what the frontend uses; the mailbox address and provider stay private.
        return {"smtpConfigured": smtp_configured(), "inviteJoinWindowMinutes": INVITE_JOIN_WINDOW_MINUTES, "verify": verify}
    return {
        "smtpConfigured": smtp_configured(),
        "mailProvider": mail_provider() if smtp_configured() else None,
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


_PLANS_TTL_S = 300.0
_plans_cache: dict = {"at": -1e9, "key": None, "plans": None}


def _public_plans() -> list:
    """Blocking. The plan catalog changes only with a deploy / migration: cached per process for 5 minutes."""
    import time

    from app.node_config import config

    key = config.database_url
    if _plans_cache["plans"] is not None and _plans_cache["key"] == key and time.monotonic() - _plans_cache["at"] < _PLANS_TTL_S:
        return _plans_cache["plans"]
    db = runtime.load_db()
    public = [p for p in db.get("subscriptionPlans") or [] if p.get("isPublic") is not False]
    _plans_cache.update(at=time.monotonic(), key=key, plans=public)
    return public


@router.get("/plans")
async def plans(request: Request):
    import asyncio
    import hashlib
    import json

    from fastapi.responses import Response

    from app.server.json_safe import json_safe

    payload = json.dumps(
        {"plans": json_safe(await asyncio.to_thread(_public_plans))}, separators=(",", ":"), default=str
    ).encode("utf-8")
    etag = 'W/"' + hashlib.sha1(payload).hexdigest()[:32] + '"'
    headers = {"Cache-Control": "public, max-age=300", "ETag": etag}
    if etag in [t.strip() for t in (request.headers.get("if-none-match") or "").split(",")]:
        return Response(status_code=304, headers=headers)
    return Response(content=payload, media_type="application/json", headers=headers)


@router.get("/organization")
async def organization(request: Request) -> dict:
    import asyncio

    email = await runtime.require_auth_email(request)
    return await asyncio.to_thread(_organization_payload, email)


def _organization_payload(email: str) -> dict:
    """Blocking (several lookups): runs in a worker thread."""
    db = runtime.load_db()
    user = find_user(db, email=email)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    tenant = runtime.tenant_context_for_user(db, user)
    org = tenant.get("organization")
    if not org:
        raise HTTPException(status_code=404, detail="No organization for this account.")
    org_id = org["id"]
    members = []
    org_members = members_of_org(db, org_id)
    users_by_id = {u.get("id"): u for u in find_users_by_ids(db, [m.get("userId") for m in org_members])}
    for m in org_members:
        u = users_by_id.get(m.get("userId"))
        members.append(
            {
                "userId": m.get("userId"),
                "role": m.get("role"),
                "email": u.get("email") if u else None,
                "name": u.get("name") if u else None,
                "joinedAt": m.get("joinedAt"),
            }
        )
    jobs = jobs_for_org(db, org_id)
    return {
        "organization": org,
        "subscription": tenant.get("subscription"),
        "plan": tenant.get("plan"),
        "members": members,
        "jobs": jobs,
    }
