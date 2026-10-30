from __future__ import annotations

import asyncio
import re
import time
from typing import Any

from fastapi import HTTPException, Request

from app.db.store import (
    delete_session_token,
    empty_db,
    load_db as load_db_from_store,
    resolve_session_email,
    save_db as persist_db,
    save_session_token,
)
from app.node_config import config

_rate_buckets: dict[str, list[float]] = {}
_db_cache: dict[str, Any] = empty_db()


def load_db_sync() -> dict[str, Any]:
    global _db_cache
    if config.database_url.strip():
        from app.demo_accounts import seed_demo_users_if_needed

        _db_cache = load_db_from_store(config.database_url)
        _db_cache, changed = seed_demo_users_if_needed(_db_cache)
        if changed:
            persist_db(_db_cache, config.database_url)
        if config.allow_demo_accounts:
            from app.demo_accounts import index_demo_jobseekers_sync

            index_demo_jobseekers_sync(_db_cache)
    return _db_cache


def set_db_cache(db: dict[str, Any]) -> None:
    global _db_cache
    _db_cache = db


def load_db() -> dict[str, Any]:
    return _db_cache


async def save_db(db: dict[str, Any] | None = None) -> None:
    global _db_cache
    if db is not None:
        _db_cache = db
    if config.database_url.strip():
        await asyncio.to_thread(persist_db, _db_cache, config.database_url)


def rate_limit(key: str, limit: int = 30, window_ms: int = 60_000) -> bool:
    now = time.time() * 1000
    bucket = [t for t in _rate_buckets.get(key, []) if now - t < window_ms]
    if len(bucket) >= limit:
        return False
    bucket.append(now)
    _rate_buckets[key] = bucket
    return True


def client_ip(request: Request) -> str:
    if config.trust_proxy:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            first = forwarded.split(",")[0].strip()
            if first:
                return first
    if request.client:
        return request.client.host
    return "local"


async def require_auth_email(request: Request) -> str:
    header = request.headers.get("authorization") or ""
    token = re.sub(r"^Bearer\s+", "", header, flags=re.I).strip()
    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")
    email = await asyncio.to_thread(resolve_session_email, config.database_url, token)
    if not email:
        raise HTTPException(status_code=401, detail="Unauthorized")
    db = load_db()
    active = any(u.get("email") == email and u.get("status") == "active" for u in db.get("users") or [])
    if not active and config.database_url.strip():
        try:
            fresh = await asyncio.to_thread(load_db_from_store, config.database_url)
            hit = next((u for u in fresh.get("users") or [] if u.get("email") == email and u.get("status") == "active"), None)
            if hit:
                users = list(db.get("users") or [])
                if not any(u.get("email") == email for u in users):
                    users.append(hit)
                    db["users"] = users
                    set_db_cache(db)
                active = True
        except Exception:
            active = False
    if not active:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return email


def tenant_context_for_user(db: dict[str, Any], user: dict | None) -> dict[str, Any]:
    if not user:
        return {"organization": None, "subscription": None, "plan": None, "membership": None}
    members = db.get("organizationMembers") or []
    membership = next(
        (m for m in members if m.get("userId") == user.get("id") and m.get("organizationId") == user.get("primaryOrganizationId")),
        None,
    ) or next((m for m in members if m.get("userId") == user.get("id")), None)
    organization = next((o for o in db.get("organizations") or [] if o.get("id") == membership.get("organizationId")), None) if membership else None
    subscription = next(
        (s for s in db.get("organizationSubscriptions") or [] if s.get("organizationId") == organization.get("id")),
        None,
    ) if organization else None
    plan = next((p for p in db.get("subscriptionPlans") or [] if p.get("id") == subscription.get("planId")), None) if subscription else None
    return {
        "organization": organization,
        "subscription": subscription,
        "plan": plan,
        "membership": membership,
    }


async def register_session(token: str, email: str) -> None:
    await asyncio.to_thread(save_session_token, config.database_url, token, email)


async def logout_token(token: str) -> None:
    await asyncio.to_thread(delete_session_token, config.database_url, token)


def _is_demo_display_name(name: str) -> bool:
    t = str(name or "").strip()
    return not t or t == "Arjun Sharma" or t.lower() == "arjun sharma"


def merge_interview_profile(db: dict[str, Any], email: str, body_profile: dict | None) -> dict:
    from app.services.interview_agent import resolve_candidate_name

    account = next((u for u in db.get("users") or [] if u.get("email") == email), None)
    stored = dict((db.get("profiles") or {}).get(email) or {})
    merged = {**stored, **(body_profile or {})}
    client_name = str(
        (body_profile or {}).get("fullName")
        or (body_profile or {}).get("name")
        or merged.get("fullName")
        or merged.get("name")
        or ""
    ).strip()
    if client_name and not _is_demo_display_name(client_name):
        return {**merged, "fullName": client_name, "name": client_name}
    resolved = resolve_candidate_name(merged, account.get("name") if account else "")
    return {**merged, "fullName": resolved, "name": resolved}


def merge_turn_into_interview_history(history: list, last_question: dict | None, last_answer: str) -> list:
    lst = list(history or [])
    if not last_question:
        return lst
    q_text = str(last_question.get("text") or last_question or "").strip()
    if not q_text:
        return lst
    if lst:
        last = lst[-1]
        prev_q = str((last.get("question") or {}).get("text") or last.get("question") or "").strip()
        if prev_q == q_text:
            last["answer"] = str(last_answer or "")
            return lst
    lst.append({"question": last_question, "answer": str(last_answer or "")})
    return lst


def build_employer_invite_context(db: dict, app: dict, job: dict | None) -> dict:
    email = str(app.get("candidateEmail") or "").lower()
    profile = (db.get("profiles") or {}).get(email) or {}
    data = app.get("data") or {}
    return {
        "source": "employer",
        "resumeText": str(data.get("resumeText") or profile.get("resumeText") or "")[:80000],
        "resumeName": data.get("resumeName") or profile.get("resumeName"),
        "jobDescription": str((job or {}).get("jobDescription") or data.get("jobDescription") or "")[:80000],
        "roleTrack": (job or {}).get("roleTrack") or data.get("candidateRole") or "",
        "experienceLevel": data.get("experienceYears") or (job or {}).get("experienceLevel") or "",
        "primarySkills": data.get("primarySkills") or (job or {}).get("requiredSkills") or [],
        "candidateRole": data.get("candidateRole") or profile.get("currentRole") or "",
    }


def build_job_seeker_invite_context(db: dict, email: str, body: dict | None = None) -> dict:
    body = body or {}
    profile = (db.get("profiles") or {}).get(email) or {}
    return {
        "source": "jobseeker",
        "resumeText": str(profile.get("resumeText") or body.get("resumeText") or "")[:80000],
        "resumeName": profile.get("resumeName") or body.get("resumeName"),
        "jobDescription": str(body.get("jobDescription") or "")[:80000],
        "roleTrack": body.get("roleTrack") or profile.get("currentRole") or "",
        "experienceLevel": body.get("experienceLevel") or profile.get("totalExperience") or "",
        "primarySkills": body.get("primarySkills") or profile.get("skills") or [],
        "jobTitle": body.get("jobTitle") or "",
    }


async def require_employer_tenant(request: Request, db: dict[str, Any]) -> dict | None:
    from fastapi import HTTPException

    email = await require_auth_email(request)
    user = next((u for u in db.get("users") or [] if u.get("email") == email), None)
    if not user or user.get("role") != "employer":
        raise HTTPException(status_code=403, detail="Employer account required.")
    tenant = tenant_context_for_user(db, user)
    if not tenant.get("organization") or not tenant["organization"].get("id"):
        raise HTTPException(status_code=403, detail="No organization linked to this employer account.")
    member_role = (tenant.get("membership") or {}).get("role") or ""
    if member_role not in ("owner", "admin", "recruiter"):
        raise HTTPException(status_code=403, detail="Recruiter access required for this organization.")
    return {"user": user, "tenant": tenant}


async def read_json_body(request: Request) -> dict:
    from fastapi import HTTPException

    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON object") from exc
    if body is None or not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid JSON object")
    return body
