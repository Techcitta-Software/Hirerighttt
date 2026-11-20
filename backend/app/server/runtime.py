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
from app.db.finders import find_organization, find_plan, find_user, memberships_for_user, subscription_for_org
from app.node_config import config
from app.server import ratelimit

# Legacy DynamoDB mode only: the whole database in one process. With Postgres every request gets its own unit of
# work (app/db/uow.py) that loads only the rows it touches, so the API can run as many instances as needed.
_db_cache: dict[str, Any] = empty_db()


# Set by set_db_cache(): an explicit in-memory database for the URL it was set under (tests seed one this way).
_memory_db_url: str | None = None


def _uses_unit_of_work() -> bool:
    from app.db.dynamo_config import database_provider

    if _memory_db_url is not None and _memory_db_url == config.database_url:
        return False
    return database_provider() != "dynamodb" and bool(config.database_url.strip())


def load_db_sync() -> dict[str, Any]:
    """Startup: make sure the schema exists and (dev only) the demo accounts. Nothing is loaded into memory."""
    global _db_cache
    from app.db.dynamo_config import database_provider

    if database_provider() == "dynamodb":
        from app.demo_accounts import seed_demo_users_if_needed

        _db_cache = load_db_from_store("")
        _db_cache, changed = seed_demo_users_if_needed(_db_cache)
        if changed:
            from app.db.dynamo_config import use_neon

            if use_neon() and config.database_url.strip():
                persist_db(_db_cache, config.database_url)
            else:
                from app.db.dynamo_relational import mirror_db_to_dynamo

                mirror_db_to_dynamo(_db_cache)
        return _db_cache
    if config.database_url.strip():
        from app.db.store import _ensure_schema
        from app.db.uow import new_uow
        from app.demo_accounts import seed_demo_users_if_needed

        _ensure_schema(config.database_url)
        uow = new_uow(config.database_url)
        _, changed = seed_demo_users_if_needed(uow)
        if changed:
            uow.flush()
        if config.allow_demo_accounts:
            from app.demo_accounts import index_demo_jobseekers_sync

            index_demo_jobseekers_sync(uow)
        return uow
    return _db_cache


def set_db_cache(db: dict[str, Any]) -> None:
    """Use `db` as an in-memory database for the current DATABASE_URL (tests, legacy DynamoDB mode).

    Production code never calls this: with Postgres each request has its own unit of work instead."""
    global _db_cache, _memory_db_url
    _db_cache = db
    _memory_db_url = config.database_url


# Collections that no process-wide read cache is built from (store._cached_rows / _throttled_sync readers and the
# vendor job-seeker roster read users, profiles, interview results, memberships, jobs and applications). Any other
# collection, including ones added later, still invalidates on write.
NO_READ_CACHE_COLLECTIONS = frozenset(
    {"interviewSessions", "candidateJobAlerts", "employerApplicationAlerts", "contactRequests", "confidentialVault"}
)


def load_db() -> dict[str, Any]:
    """The request's database handle. Postgres: a per-request unit of work. DynamoDB (legacy): the shared dict."""
    if _uses_unit_of_work():
        from app.db.uow import current_uow

        return current_uow(config.database_url)
    return _db_cache


async def save_db(db: dict[str, Any] | None = None) -> None:
    global _db_cache
    from app.db.uow import UnitOfWork

    target = db if db is not None else load_db()
    if isinstance(target, UnitOfWork):
        from app.db.store import invalidate_read_caches

        try:
            await asyncio.to_thread(target.flush)
        finally:
            # Only writes that can change a cached read clear the caches: a save with nothing to write, or one that
            # only touched interview sessions / alerts (every interview turn), used to wipe them for everyone.
            if target.last_flushed - NO_READ_CACHE_COLLECTIONS:
                invalidate_read_caches()
        return
    if db is not None:
        _db_cache = db
    from app.db.dynamo_config import database_provider, use_neon

    if use_neon() and config.database_url.strip():
        await asyncio.to_thread(persist_db, _db_cache, config.database_url)
    elif database_provider() == "dynamodb":
        from app.db.dynamo_relational import mirror_db_to_dynamo

        await asyncio.to_thread(mirror_db_to_dynamo, _db_cache)


def rate_limit(key: str, limit: int = 30, window_ms: int = 60_000, *, strict: bool = False) -> bool:
    """Shared (Redis) when REDIS_URL is set, otherwise per-process. See app/server/ratelimit.py."""
    return ratelimit.allow(key, limit, window_ms, strict=strict)


def client_ip(request: Request) -> str:
    if config.trust_proxy:
        # Behind CloudFront: the viewer's real address ("ip:port", set by CloudFront; a client cannot forge it, and the
        # load balancer only accepts requests that came through CloudFront). The first X-Forwarded-For entry, by
        # contrast, is whatever the client sent, so per-IP rate limits could be dodged with a fake header.
        viewer = (request.headers.get("cloudfront-viewer-address") or "").strip()
        if viewer:
            return viewer.rsplit(":", 1)[0].strip("[]") or viewer
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            first = forwarded.split(",")[0].strip()
            if first:
                return first
    if request.client:
        return request.client.host
    return "local"


# token -> (email, expires_at_monotonic). Every authenticated request used to query Postgres for the
# session; on a remote database that cost ~0.5-1s per call and a login makes several calls.
# Entries live briefly and are dropped on logout / password reset (forget_sessions). The cache is per worker
# process: a logout or password reset handled by ANOTHER worker takes effect here within this TTL (V-18), so it is
# kept short. SESSION_CACHE_TTL_SECONDS=0 disables it.
_SESSION_CACHE: dict[str, tuple[str, float]] = {}
try:
    _SESSION_CACHE_TTL_S = max(0.0, float(__import__("os").environ.get("SESSION_CACHE_TTL_SECONDS", "20") or 20))
except ValueError:
    _SESSION_CACHE_TTL_S = 20.0


def _cached_session_email(token: str) -> str | None:
    hit = _SESSION_CACHE.get(token)
    if not hit:
        return None
    email, expires = hit
    if time.monotonic() >= expires:
        _SESSION_CACHE.pop(token, None)
        return None
    return email


def remember_session(token: str, email: str) -> None:
    if _SESSION_CACHE_TTL_S <= 0:
        return
    if len(_SESSION_CACHE) > 5000:
        _SESSION_CACHE.clear()
    _SESSION_CACHE[token] = (email, time.monotonic() + _SESSION_CACHE_TTL_S)


def forget_sessions(*, token: str | None = None, email: str | None = None) -> None:
    if token:
        _SESSION_CACHE.pop(token, None)
    if email:
        for t in [t for t, (e, _) in _SESSION_CACHE.items() if e == email]:
            _SESSION_CACHE.pop(t, None)


async def require_auth_email(request: Request) -> str:
    header = request.headers.get("authorization") or ""
    token = re.sub(r"^Bearer\s+", "", header, flags=re.I).strip()
    if not token or len(token) > 256:
        raise HTTPException(status_code=401, detail="Unauthorized")
    email = _cached_session_email(token)
    if email:
        # P-11: the cache only holds sessions whose account was active when it was filled (same short TTL), so a
        # cache hit needs no second query. A disabled account is dropped from the cache by forget_sessions().
        return email
    email = await asyncio.to_thread(resolve_session_email, config.database_url, token)
    if not email:
        raise HTTPException(status_code=401, detail="Unauthorized")
    db = load_db()
    active = await asyncio.to_thread(lambda: find_user(db, email=email, active_only=True) is not None)
    if not active:
        raise HTTPException(status_code=401, detail="Unauthorized")
    remember_session(token, email)
    return email


def tenant_context_for_user(db: dict[str, Any], user: dict | None) -> dict[str, Any]:
    if not user:
        return {"organization": None, "subscription": None, "plan": None, "membership": None}
    members = memberships_for_user(db, user.get("id"))
    membership = next(
        (m for m in members if m.get("organizationId") == user.get("primaryOrganizationId")),
        None,
    ) or next(iter(members), None)
    organization = find_organization(db, membership.get("organizationId")) if membership else None
    subscription = subscription_for_org(db, organization.get("id")) if organization else None
    plan = find_plan(db, subscription.get("planId")) if subscription else None
    return {
        "organization": organization,
        "subscription": subscription,
        "plan": plan,
        "membership": membership,
    }


async def register_session(token: str, email: str) -> None:
    await asyncio.to_thread(save_session_token, config.database_url, token, email)
    remember_session(token, email)


async def logout_token(token: str) -> None:
    forget_sessions(token=token)
    await asyncio.to_thread(delete_session_token, config.database_url, token)


def _is_demo_display_name(name: str) -> bool:
    t = str(name or "").strip()
    return not t or t == "Arjun Sharma" or t.lower() == "arjun sharma"


def merge_interview_profile(db: dict[str, Any], email: str, body_profile: dict | None) -> dict:
    from app.services.interview_agent import resolve_candidate_name

    account = find_user(db, email=email)
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
        merged = {**merged, "fullName": client_name, "name": client_name}
    # One rule for the name everywhere: a saved name that matches neither the current resume nor the account name is
    # stale (left over from an older resume) and is replaced, so the interview never greets someone by another name.
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
    user = await asyncio.to_thread(find_user, db, email=email)
    if not user or user.get("role") != "employer":
        raise HTTPException(status_code=403, detail="Employer account required.")
    tenant = await asyncio.to_thread(tenant_context_for_user, db, user)
    if not tenant.get("organization") or not tenant["organization"].get("id"):
        raise HTTPException(status_code=403, detail="No organization linked to this employer account.")
    member_role = (tenant.get("membership") or {}).get("role") or ""
    if member_role not in ("owner", "admin", "recruiter"):
        raise HTTPException(status_code=403, detail="Recruiter access required for this organization.")
    return {"user": user, "tenant": tenant}


def is_platform_admin(email: str | None) -> bool:
    """Platform admins (ADMIN_EMAILS, comma separated) are the only accounts allowed to view interview video."""
    import os

    wanted = (email or "").strip().lower()
    if not wanted:
        return False
    allowed = {e.strip().lower() for e in (os.environ.get("ADMIN_EMAILS") or "").split(",") if e.strip()}
    if config.allow_demo_accounts:
        allowed.add("admin@hireright.com")
    return wanted in allowed


async def read_json_body(request: Request) -> dict:
    from fastapi import HTTPException

    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON object") from exc
    if body is None or not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid JSON object")
    return body
