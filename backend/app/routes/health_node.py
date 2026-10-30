from __future__ import annotations

import os

from fastapi import APIRouter

from app.db.store import ping_database
from app.node_config import config

router = APIRouter()


def _llm_configured() -> bool:
    return bool(
        os.environ.get("GEMINI_API_KEY")
        or os.environ.get("OPENAI_API_KEY")
        or os.environ.get("OPENROUTER_API_KEY")
        or os.environ.get("LLM_API_KEY")
    )


@router.get("/health")
async def health() -> dict:
    db_ping = await _async_ping()
    deploy_ref = (
        os.environ.get("RENDER_GIT_COMMIT")
        or os.environ.get("VERCEL_GIT_COMMIT_SHA")
        or os.environ.get("GIT_COMMIT")
    )
    api_build_id = os.environ.get("API_BUILD_ID") or "hireright-neon-2026-10-16"
    s3_bucket = os.environ.get("S3_BUCKET")
    s3_region = os.environ.get("AWS_REGION")
    s3_ok = bool(s3_bucket and s3_region and os.environ.get("AWS_ACCESS_KEY_ID"))
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
        "database": {
            "configured": bool(config.database_url),
            "storage": "postgresql",
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


async def _async_ping() -> dict:
    if not config.database_url:
        return {"ok": False, "reason": "DATABASE_URL not set"}
    import asyncio

    return await asyncio.to_thread(ping_database, config.database_url)
