from __future__ import annotations

from app.db.finders import session_items_for_email
from app.db.finders import find_user
import json
from typing import Any

from app.db import db_pool
from app.db.talent_index import upsert_candidate_talent
from app.services import interview_api as ia
from app.services.candidate_name import apply_resume_name
from app.services.storage.resume_storage import (
    object_storage_configured,
    parse_resume_upload_body,
    public_object_storage_error,
    upload_resume_to_object_storage,
)
from app.services.storage.s3_key_layout import key_belongs_to_candidate
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
    "resumeFullName",
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
    if patch.get("fullName") and not patch.get("resumeFullName"):
        patch["resumeFullName"] = patch["fullName"]  # the parsed resume name (checked against the text below)
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


def _row_key(row) -> str:
    """psycopg rows are dicts on the app pool (dict_row) and tuples elsewhere. `for (key,) in rows` on a dict row
    unpacked the COLUMN NAME, so old recordings were never deleted from S3 (V-30)."""
    if isinstance(row, dict):
        return str(row.get("s3_object_key") or "")
    return str(row[0] or "") if row else ""


def _purge_postgres_sync(pool, email: str, prev: dict, owner_user_id: str | None) -> dict[str, int]:
    """Blocking (runs in a worker thread). Deletes only objects inside this candidate's own users/<id>/ folders."""
    recordings = artifacts = 0
    s3 = s3_storage_configured()

    def _delete_owned(key: str, kind: str | None = None) -> None:
        if s3 and key and key_belongs_to_candidate(key, user_id=owner_user_id, email=email, kind=kind):
            delete_object(key)

    with pool.connection() as conn:
        # V-03: the previous resume key came from the profile; never delete outside the caller's resume folder.
        _delete_owned(str(prev.get("resumeStoragePath") or ""), "resume")
        recs = conn.execute(
            """SELECT s3_object_key FROM interview_recordings
               WHERE lower(candidate_email) = lower(%s)
                 AND status IN ('uploaded', 'completed', 'ready')""",
            (email,),
        ).fetchall()
        for row in recs:
            recordings += 1
            _delete_owned(_row_key(row))
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
        for row in arts:
            artifacts += 1
            _delete_owned(_row_key(row))
        conn.execute(
            """UPDATE interview_artifacts SET status = 'deleted', updated_at = NOW()
               WHERE lower(candidate_email) = lower(%s)""",
            (email,),
        )
        conn.execute("DELETE FROM interview_results WHERE lower(email) = lower(%s)", (email,))
        conn.commit()
    return {"recordings": recordings, "artifacts": artifacts}


async def _purge_prior_artifacts(pool, email: str, prev: dict, db: dict, owner_user_id: str | None = None) -> dict[str, int]:
    import asyncio

    recordings = artifacts = 0
    if pool:
        counts = await asyncio.to_thread(_purge_postgres_sync, pool, email, prev, owner_user_id)
        recordings, artifacts = counts["recordings"], counts["artifacts"]
    db.setdefault("interviews", {})
    db.setdefault("interviewSessions", {})
    db["interviews"].pop(email, None)
    for sid, _session in session_items_for_email(db, email):
        db["interviewSessions"].pop(sid, None)
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
    import asyncio

    db.setdefault("profiles", {})
    account = await asyncio.to_thread(find_user, db, email=email)
    prev = dict(db["profiles"].get(email) or {})
    pool = db_pool(config.database_url) if config.database_url else None
    owner_id = account.get("id") if account else None
    purged = await _purge_prior_artifacts(pool, email, prev, db, owner_id)
    extract = body.get("extract") if isinstance(body.get("extract"), dict) else None
    resume_text = str(body.get("resumeText") or (extract or {}).get("resumeText") or "").strip()[:100000]

    async def _no_parse() -> None:
        return None

    import asyncio

    # The S3 upload and the AI parse are independent: run them together instead of one after the other.
    uploaded, parsed_extract = await asyncio.gather(
        upload_resume_to_object_storage(
            candidateEmail=email,
            ownerUserId=owner_id,
            filename=parsed["filename"],
            buffer=parsed["buffer"],
            contentType=parsed.get("contentType"),
        ),
        ia.parse_resume_with_ai(resume_text) if (not extract and len(resume_text) >= 40) else _no_parse(),
    )
    if not extract:
        extract = parsed_extract
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
    # The new resume's name replaces the old one everywhere (profile, talent index, recruiter views).
    profile_patch = apply_resume_name(profile_patch, (account or {}).get("name") or "")
    db["profiles"][email] = profile_patch
    await save_db(db)
    if pool:

        def _write_profile() -> None:
            with pool.connection() as conn:
                conn.execute(
                    """INSERT INTO profiles (email, data, updated_at)
                       VALUES (%s, %s::jsonb, NOW())
                       ON CONFLICT (email) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()""",
                    (email, json.dumps(profile_patch)),
                )
                conn.commit()

        await asyncio.to_thread(_write_profile)
    if account and config.database_url:
        try:
            await upsert_candidate_talent(config.database_url, account, profile_patch, None)
        except Exception:
            import logging

            logging.getLogger("hireright.resume").warning("talent index update failed", exc_info=True)
    return {"profile": profile_patch, "purged": purged, "storagePath": uploaded["storagePath"]}


def public_replace_resume_error(err: Exception) -> dict:
    if getattr(err, "skipped", False):
        return {"status": getattr(err, "status", 503), "body": {"error": str(err), "skipped": True}}
    status = getattr(err, "status", 502)
    return {"status": status, "body": {"error": public_object_storage_error(err, "Could not replace resume. Please try again.")}}
