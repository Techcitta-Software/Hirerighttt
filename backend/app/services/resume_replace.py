from __future__ import annotations

import json
from typing import Any

from app.db import db_pool
from app.db.talent_index import upsert_candidate_talent
from app.services import interview_api as ia
from app.services.storage.resume_storage import (
    object_storage_configured,
    parse_resume_upload_body,
    public_object_storage_error,
    upload_resume_to_object_storage,
)
from app.services.storage.s3_storage import delete_object, s3_storage_configured

RESUME_SOURCED_KEYS = (
    "resumeText",
    "skills",
    "workExperiences",
    "experienceSummary",
    "achievements",
    "certifications",
    "metrics",
    "whoAreYou",
    "whatDrivesYou",
    "keyStrengths",
    "awards",
    "noPriorWorkExperience",
    "fullName",
    "name",
    "currentRole",
    "totalExperience",
    "currentLocation",
    "preferredRoles",
    "preferredLocations",
    "noticePeriod",
    "salaryExpectation",
    "workMode",
)


def build_resume_replacement_profile(prev: dict, *, extract: dict, upload: dict, filename: str) -> dict:
    base = dict(prev or {})
    for key in RESUME_SOURCED_KEYS:
        base.pop(key, None)
    patch = dict(extract or {})
    if patch.get("fullName") and not patch.get("name"):
        patch["name"] = patch["fullName"]
    from datetime import datetime, timezone

    return {
        **base,
        **patch,
        "resumeName": filename,
        **upload,
        "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


async def _purge_prior_artifacts(pool, email: str, prev: dict, db: dict) -> dict[str, int]:
    recordings = artifacts = 0
    if pool:
        with pool.connection() as conn:
            if s3_storage_configured() and prev.get("resumeStoragePath"):
                delete_object(str(prev["resumeStoragePath"]))
            recs = conn.execute(
                """SELECT s3_object_key FROM interview_recordings
                   WHERE lower(candidate_email) = lower(%s)
                     AND status IN ('uploaded', 'completed', 'ready')""",
                (email,),
            ).fetchall()
            for (key,) in recs:
                recordings += 1
                if s3_storage_configured():
                    delete_object(str(key))
            conn.execute(
                """UPDATE interview_recordings SET status = 'deleted', updated_at = NOW()
                   WHERE lower(candidate_email) = lower(%s)""",
                (email,),
            )
            arts = conn.execute(
                """SELECT s3_object_key FROM interview_artifacts
                   WHERE lower(candidate_email) = lower(%s) AND status = 'ready'""",
                (email,),
            ).fetchall()
            for (key,) in arts:
                artifacts += 1
                if s3_storage_configured():
                    delete_object(str(key))
            conn.execute(
                """UPDATE interview_artifacts SET status = 'deleted', updated_at = NOW()
                   WHERE lower(candidate_email) = lower(%s)""",
                (email,),
            )
            conn.execute("DELETE FROM interview_results WHERE lower(email) = lower(%s)", (email,))
            conn.commit()
    db.setdefault("interviews", {})
    db.setdefault("interviewSessions", {})
    db["interviews"].pop(email, None)
    for sid, session in list(db.get("interviewSessions", {}).items()):
        if str((session or {}).get("email") or "").lower() == email:
            del db["interviewSessions"][sid]
    return {"recordings": recordings, "artifacts": artifacts}


async def replace_candidate_resume(**opts: Any) -> dict[str, Any]:
    if not object_storage_configured():
        err = RuntimeError("Resume object storage is not configured (S3 or Supabase).")
        err.status = 503  # type: ignore[attr-defined]
        err.skipped = True  # type: ignore[attr-defined]
        raise err
    config = opts["config"]
    email = str(opts["email"]).lower()
    body = opts["body"]
    db = opts["db"]
    save_db = opts["save_db"]
    parsed = parse_resume_upload_body(body)
    db.setdefault("profiles", {})
    account = next((u for u in db.get("users") or [] if u.get("email") == email), None)
    prev = dict(db["profiles"].get(email) or {})
    pool = db_pool(config.database_url) if config.database_url else None
    purged = await _purge_prior_artifacts(pool, email, prev, db)
    uploaded = await upload_resume_to_object_storage(
        candidateEmail=email,
        ownerUserId=account.get("id") if account else None,
        filename=parsed["filename"],
        buffer=parsed["buffer"],
        contentType=parsed.get("contentType"),
    )
    extract = body.get("extract") if isinstance(body.get("extract"), dict) else None
    resume_text = str(body.get("resumeText") or (extract or {}).get("resumeText") or "").strip()
    if not extract and len(resume_text) >= 40:
        extract = await ia.parse_resume_with_ai(resume_text)
    if not extract:
        extract = {"resumeText": resume_text[:12000]} if resume_text else {}
    elif resume_text and not extract.get("resumeText"):
        extract["resumeText"] = resume_text[:12000]
    profile_patch = build_resume_replacement_profile(
        prev,
        extract=extract,
        upload={
            "resumeStoragePath": uploaded["storagePath"],
            "resumeUrl": uploaded["resumeUrl"],
            "resumeFileId": uploaded.get("fileId"),
            "storageProvider": uploaded["storageProvider"],
        },
        filename=parsed["filename"],
    )
    db["profiles"][email] = profile_patch
    await save_db(db)
    if pool:
        with pool.connection() as conn:
            conn.execute(
                """INSERT INTO profiles (email, data, updated_at)
                   VALUES (%s, %s::jsonb, NOW())
                   ON CONFLICT (email) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()""",
                (email, json.dumps(profile_patch)),
            )
            conn.commit()
    if account and config.database_url:
        try:
            await upsert_candidate_talent(config.database_url, account, profile_patch, None)
        except Exception as err:
            print("[resume-replace] talent index:", err)
    return {"profile": profile_patch, "purged": purged, "storagePath": uploaded["storagePath"]}


def public_replace_resume_error(err: Exception) -> dict:
    if getattr(err, "skipped", False):
        return {"status": getattr(err, "status", 503), "body": {"error": str(err), "skipped": True}}
    status = getattr(err, "status", 502)
    return {"status": status, "body": {"error": public_object_storage_error(err, "Could not replace resume. Please try again.")}}
