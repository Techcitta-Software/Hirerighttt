from __future__ import annotations

import os

import hmac

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.db.store import ping_database
from app.node_config import config, is_prod_like

router = APIRouter()


def _llm_configured() -> bool:
    from app.services.gemini_client import gemini_configured

    return gemini_configured()


def _failover_summary() -> dict:
    from app.services.gemini_client import status_snapshot

    snap = status_snapshot()
    return {
        "keys": snap["keyCount"],
        "keysAvailable": sum(1 for k in snap["keys"] if k["available"]),
        "fallbackModels": snap["models"][1:],
        "lastError": snap["lastError"],
    }


def health_detail_allowed(request: Request) -> bool:
    """V-20: bucket names, DB errors, model names and key health are recon for an attacker. Public callers on a
    production-like deployment get {ok, service, version, llm, features}; the full report needs X-Cron-Secret."""
    if not is_prod_like:
        return True
    secret = os.environ.get("CRON_SECRET") or ""
    given = request.headers.get("x-cron-secret") or ""
    return bool(secret) and hmac.compare_digest(secret.encode(), given.encode("utf-8", "replace"))


def _deep_select(database_url: str) -> bool:
    """SELECT 1 on a fresh connection. connect_timeout is 30s so a suspended database can wake up."""
    url = (database_url or "").strip()
    if not url:
        return False
    import psycopg

    try:
        with psycopg.connect(url, connect_timeout=30) as conn:
            row = conn.execute("SELECT 1").fetchone()
        if not row:
            return False
        value = row[0] if not isinstance(row, dict) else next(iter(row.values()), None)
        return value == 1
    except Exception as exc:
        import logging

        logging.getLogger("hireright.health").warning("deep health check failed: %s", type(exc).__name__)
        return False


async def _deep_ok() -> bool:
    import asyncio

    return await asyncio.to_thread(_deep_select, config.database_url)


@router.get("/health", response_model=None)
async def health(request: Request) -> dict | JSONResponse:
    if request.query_params.get("deep") == "1":
        ok = await _deep_ok()
        return JSONResponse(status_code=200 if ok else 503, content={"ok": ok, "deep": True})
    full = await _health_full()
    if health_detail_allowed(request):
        return full
    return {
        "ok": full["ok"],
        "service": full["service"],
        "version": full["version"],
        "llm": full["llm"],
        "database": {"connected": full["database"]["connected"]},
        "features": full["features"],
        "runtime": "python",
    }


async def _health_full() -> dict:
    db_ping = await _async_ping()
    deploy_ref = (
        os.environ.get("RENDER_GIT_COMMIT")
        or os.environ.get("VERCEL_GIT_COMMIT_SHA")
        or os.environ.get("GIT_COMMIT")
    )
    api_build_id = os.environ.get("API_BUILD_ID") or "hireright-neon-2026-10-16"
    s3_bucket = os.environ.get("S3_BUCKET")
    s3_region = os.environ.get("AWS_REGION")
    s3_ok = bool(s3_bucket and s3_region)  # credentials: ECS task role on AWS, access keys locally
    object_provider = "s3" if s3_ok else None
    if not s3_ok and os.environ.get("DISABLE_SUPABASE") != "true":
        if os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
            object_provider = "supabase"
    return {
        "ok": True,
        "service": "hireright-api",
        "version": "2.0.0",
        "apiBuildId": api_build_id,
        "deployRef": deploy_ref,
        "llm": _llm_configured(),
        "models": {
            "model": os.environ.get("PRIMARY_MODEL") or os.environ.get("FAST_MODEL") or "local",
        },
        "llmFailover": _failover_summary(),
        "database": {
            "configured": bool(config.database_url),
            "storage": "postgres",
            "connected": bool(db_ping.get("ok")),
            "detail": db_ping.get("reason"),
        },
        "features": {
            "interviewAgent": True,
            "resumeAwareQuestions": True,
            "adaptiveScoring": True,
            "faceIntegrityClient": True,
            "openrouterActive": bool(os.environ.get("OPENROUTER_API_KEY")),
            "groqWhisper": False,
            "sileroVadClient": True,
            "moonshineSttClient": True,
            "deepFilterNet3Client": True,
        },
        "objectStorage": {
            "configured": s3_ok or object_provider == "supabase",
            "provider": object_provider,
            "bucket": s3_bucket,
            "region": s3_region,
            "layout": "users/{userId}/{resume,video,transcript,report}" if s3_ok else None,
            "objectKinds": [
                "resume (server PutObject)",
                "interview_transcript (server PutObject JSON)",
                "interview_report (server PutObject PDF)",
                "interview_recording (browser presigned PutObject)",
            ]
            if s3_ok
            else [],
        },
        "runtime": "python",
    }


# The app checks /api/health before loading most pages; a fresh database round trip each time added ~1s
# of dead air per page. A healthy ping is reused briefly; a failed one is always re-checked.
PING_CACHE_SECONDS = 15.0
_ping_cache: dict = {"at": 0.0, "value": None}


async def _async_ping() -> dict:
    from app.db.persistence import persistence_ready
    if not persistence_ready(config.database_url):
        return {"ok": False, "reason": "Database not configured (set DATABASE_URL)"}
    import asyncio
    import time

    cached = _ping_cache["value"]
    if cached is not None and cached.get("ok") and time.monotonic() - _ping_cache["at"] < PING_CACHE_SECONDS:
        return cached
    value = await asyncio.to_thread(ping_database, config.database_url or "")
    if not value.get("ok") and value.get("reason"):
        import logging

        logging.getLogger("hireright.health").warning("database ping failed: %s", value.get("reason"))
        if is_prod_like:
            value = {**value, "reason": "Database unreachable"}  # V-21: no hostnames / driver messages to clients
    _ping_cache["at"] = time.monotonic()
    _ping_cache["value"] = value
    return value
