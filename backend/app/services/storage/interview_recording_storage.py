from __future__ import annotations

import os
from typing import Any

from app.services.storage import interview_recordings_repo as rec_repo
from app.services.storage.s3_key_layout import (
    build_interview_recording_object_key,
    extension_from_filename,
    resolve_candidate_storage_id,
    resolve_tenant_id,
)
from app.services.storage.s3_storage import (
    active_s3_bucket_name,
    head_object,
    presign_download,
    s3_env,
    s3_storage_configured,
    upload_object,
)

MAX_RECORDING_BYTES = int(os.environ.get("S3_MAX_RECORDING_BYTES") or 104_857_600)
ALLOWED_RECORDING_TYPES = frozenset(
    {"video/webm", "video/mp4", "video/x-matroska", "application/octet-stream"}
)


class StorageError(Exception):
    def __init__(self, message: str, *, status: int = 500, skipped: bool = False):
        super().__init__(message)
        self.status = status
        self.skipped = skipped


async def ensure_interview_session_for_candidate(db: dict, pool, session_id: str, requester_email: str) -> dict | None:
    sid = str(session_id or "").strip()
    email = str(requester_email or "").strip().lower()
    if not sid or not email:
        return None
    cached = (db.get("interviewSessions") or {}).get(sid)
    if cached and str(cached.get("email") or "").lower() == email:
        return cached
    if not pool:
        return None
    with pool.connection() as conn:
        cur = conn.execute(
            "SELECT email, data FROM interview_sessions WHERE session_id = %s",
            (sid,),
        )
        row = cur.fetchone()
    if not row:
        return None
    session = row[1] or {}
    if not session.get("email"):
        session["email"] = row[0]
    if str(session.get("email") or "").lower() != email:
        return None
    db.setdefault("interviewSessions", {})[sid] = session
    return session


def infer_recording_content_type(content_type: str, filename: str) -> str:
    ct = str(content_type or "").split(";")[0].strip().lower()
    if ct in ALLOWED_RECORDING_TYPES:
        if ct == "application/octet-stream":
            ext = extension_from_filename(filename)
            return "video/mp4" if ext == ".mp4" else "video/webm"
        return ct
    ext = extension_from_filename(filename)
    if ext == ".mp4":
        return "video/mp4"
    if ext == ".webm":
        return "video/webm"
    raise StorageError("Recording must be WebM or MP4.", status=400)


async def _presign_recording_playback(row: dict[str, Any]) -> dict[str, Any]:
    bucket = active_s3_bucket_name()
    if bucket and row.get("bucket") and str(row["bucket"]) != bucket:
        raise StorageError("Interview recording is not available in current storage.", status=404)
    head = head_object(str(row["s3_object_key"]))
    if not head:
        raise StorageError("Recording file is missing from storage.", status=404)
    safe_name = str(row.get("original_filename") or "interview.webm").replace('"', "")
    content_type = str(row.get("content_type") or "video/webm").split(";")[0].strip()
    signed = presign_download(
        str(row["s3_object_key"]),
        disposition=f'inline; filename="{safe_name}"',
        content_type=content_type,
    )
    return {
        **signed,
        "contentType": content_type,
        "filename": safe_name,
        "interviewId": row.get("interview_id"),
        "durationSeconds": row.get("duration_seconds"),
        "fileSizeBytes": row.get("file_size_bytes"),
    }


async def authorize_interview_recording_upload(**opts: Any) -> dict[str, Any]:
    if not s3_storage_configured():
        raise StorageError("Interview recording storage is not configured (S3).", status=503, skipped=True)
    email = str(opts["requesterEmail"]).lower()
    session_id = str(opts.get("sessionId") or "").strip()
    session = await ensure_interview_session_for_candidate(opts["db"], opts["pool"], session_id, email)
    if not session:
        raise StorageError("Interview session not found.", status=404)
    file_size = float(opts.get("fileSize") or 0)
    if file_size < 256:
        raise StorageError("Recording file is too small.", status=400)
    if file_size > MAX_RECORDING_BYTES:
        raise StorageError(f"Recording exceeds maximum size ({MAX_RECORDING_BYTES} bytes).", status=413)
    filename = str(opts.get("filename") or "interview_recording.webm")
    content_type = infer_recording_content_type(str(opts.get("contentType") or ""), filename)
    tenant_id = resolve_tenant_id(user=opts.get("account"), session_organization_id=session.get("organizationId"))
    candidate_id = resolve_candidate_storage_id(account=opts.get("account"), session=session, email=email)
    object_key = build_interview_recording_object_key(
        tenant_id=tenant_id,
        interview_id=session_id,
        candidate_id=candidate_id,
        original_filename=filename,
        content_type=content_type,
    )
    bucket = s3_env()["bucket"]
    try:
        recording_id = rec_repo.insert_interview_recording(
            opts["pool"],
            {
                "tenantId": tenant_id,
                "interviewId": session_id,
                "candidateId": candidate_id,
                "candidateEmail": email,
                "s3ObjectKey": object_key,
                "bucket": bucket,
                "originalFilename": filename,
                "contentType": content_type,
                "fileSizeBytes": int(file_size),
                "status": "uploading",
            },
        )
    except Exception as db_err:
        print("[recording-upload] metadata insert failed — run npm run db:init", db_err)
        raise StorageError("Could not create recording metadata.", status=503) from db_err
    presigned = presign_upload(key=object_key, content_type=content_type, content_length=int(file_size))
    return {
        "recordingId": recording_id,
        "objectKey": object_key,
        "bucket": bucket,
        "uploadUrl": presigned["url"],
        "uploadMethod": presigned["method"],
        "expiresInSeconds": presigned["expiresInSeconds"],
        "contentType": content_type,
    }


async def complete_interview_recording_upload(**opts: Any) -> dict[str, Any]:
    row = rec_repo.get_interview_recording_by_id(opts["pool"], str(opts.get("recordingId") or ""))
    if not rec_repo.can_access_interview_recording(opts["requesterEmail"], row):
        raise StorageError("Recording not found.", status=404)
    if str(row["interview_id"]) != str(opts.get("sessionId") or ""):
        raise StorageError("Recording does not match this interview session.", status=403)
    head = head_object(str(row["s3_object_key"]))
    if not head:
        rec_repo.update_interview_recording(opts["pool"], str(opts["recordingId"]), {"status": "failed"})
        raise StorageError("Recording file was not found in storage.", status=400)
    size = int(head.get("ContentLength") or row.get("file_size_bytes") or 0)
    rec_repo.update_interview_recording(
        opts["pool"],
        str(opts["recordingId"]),
        {
            "status": "uploaded",
            "fileSizeBytes": size,
            "durationSeconds": opts.get("durationSeconds"),
        },
    )
    return {"recordingId": opts["recordingId"], "objectKey": row["s3_object_key"], "status": "uploaded"}


async def store_interview_recording_bytes(**opts: Any) -> dict[str, Any]:
    """Save the interview video with boto3 under users/{id}/video/."""
    if not s3_storage_configured():
        raise StorageError("Interview recording storage is not configured (S3).", status=503, skipped=True)
    data = opts.get("data") or b""
    if not isinstance(data, (bytes, bytearray)):
        raise StorageError("Recording file is missing.", status=400)
    email = str(opts["requesterEmail"]).lower()
    session_id = str(opts.get("sessionId") or "").strip()
    session = await ensure_interview_session_for_candidate(opts["db"], opts["pool"], session_id, email)
    if not session:
        raise StorageError("Interview session not found.", status=404)
    file_size = len(data)
    if file_size < 256:
        raise StorageError("Recording file is too small.", status=400)
    if file_size > MAX_RECORDING_BYTES:
        raise StorageError(f"Recording exceeds maximum size ({MAX_RECORDING_BYTES} bytes).", status=413)
    filename = str(opts.get("filename") or "interview_recording.webm")
    content_type = infer_recording_content_type(str(opts.get("contentType") or ""), filename)
    tenant_id = resolve_tenant_id(user=opts.get("account"), session_organization_id=session.get("organizationId"))
    candidate_id = resolve_candidate_storage_id(account=opts.get("account"), session=session, email=email)
    object_key = build_interview_recording_object_key(
        tenant_id=tenant_id,
        interview_id=session_id,
        candidate_id=candidate_id,
        original_filename=filename,
        content_type=content_type,
    )
    bucket = s3_env()["bucket"]
    upload_object(key=object_key, body=bytes(data), content_type=content_type)
    try:
        recording_id = rec_repo.insert_interview_recording(
            opts["pool"],
            {
                "tenantId": tenant_id,
                "interviewId": session_id,
                "candidateId": candidate_id,
                "candidateEmail": email,
                "s3ObjectKey": object_key,
                "bucket": bucket,
                "originalFilename": filename,
                "contentType": content_type,
                "fileSizeBytes": file_size,
                "status": "uploaded",
                "durationSeconds": opts.get("durationSeconds"),
            },
        )
    except Exception as db_err:
        print("[recording-upload] metadata insert failed — run npm run db:init", db_err)
        raise StorageError("Could not save recording metadata.", status=503) from db_err
    return {"recordingId": recording_id, "objectKey": object_key, "bucket": bucket, "status": "uploaded"}


async def resolve_interview_recording_download(**opts: Any) -> dict[str, Any]:
    from app.services.interview_review import can_review_recording

    row = rec_repo.get_interview_recording_by_id(opts["pool"], str(opts.get("recordingId") or ""))
    if not can_review_recording(str(opts.get("tenantId") or ""), row):
        raise StorageError("Recording not found.", status=404)
    if row.get("status") not in ("uploaded", "completed"):
        raise StorageError("Recording is not ready for playback.", status=409)
    return await _presign_recording_playback(row)


async def resolve_candidate_interview_recording_playback(**opts: Any) -> dict[str, Any]:
    email = str(opts["requesterEmail"]).lower()
    session_id = str(opts.get("sessionId") or "").strip()
    session = await ensure_interview_session_for_candidate(opts["db"], opts["pool"], session_id, email)
    if not session:
        raise StorageError("Interview session not found.", status=404)
    if not s3_storage_configured():
        raise StorageError("Interview recording storage is not configured (S3).", status=503)
    bucket = active_s3_bucket_name()
    row = rec_repo.get_interview_recording_for_session(opts["pool"], session_id, email, bucket)
    if not row or not rec_repo.can_access_interview_recording(email, row):
        raise StorageError("Interview recording not found.", status=404)
    if row.get("status") not in ("uploaded", "completed"):
        raise StorageError("Recording is not ready for playback.", status=409)
    return await _presign_recording_playback(row)


async def resolve_employer_candidate_recording_playback(**opts: Any) -> dict[str, Any]:
    from app.services.interview_review import employer_can_review_recording
    from app.services.vendor.candidate_documents import assert_vendor_may_view_candidate_documents

    assert_vendor_may_view_candidate_documents(
        opts["db"],
        opts["organizationId"],
        opts["candidateEmail"],
        opts.get("recruiterScope"),
    )
    bucket = active_s3_bucket_name()
    session_id = str(opts.get("interviewId") or "").strip()
    if session_id:
        row = rec_repo.get_interview_recording_for_session(opts["pool"], session_id, opts["candidateEmail"], bucket)
    else:
        row = rec_repo.get_latest_interview_recording_for_candidate(opts["pool"], opts["candidateEmail"], bucket)
    if not employer_can_review_recording(opts["db"], opts["organizationId"], opts["candidateEmail"], row):
        raise StorageError("Interview recording not found.", status=404)
    return await _presign_recording_playback(row)
