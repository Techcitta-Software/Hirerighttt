from __future__ import annotations

import base64
import json
import os
from typing import Any

from app.services.storage import interview_artifacts_repo as art_repo
from app.services.storage.s3_key_layout import (
    build_interview_report_object_key,
    build_interview_transcript_object_key,
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

MAX_REPORT_BYTES = int(os.environ.get("S3_MAX_REPORT_BYTES") or 12_000_000)


class ArtifactStorageError(Exception):
    def __init__(self, message: str, *, status: int = 500, skipped: bool = False):
        super().__init__(message)
        self.status = status
        self.skipped = skipped


def _assert_bucket(row: dict) -> None:
    bucket = active_s3_bucket_name()
    if bucket and row.get("bucket") and str(row["bucket"]) != bucket:
        raise ArtifactStorageError("Interview artifact is not available in current storage.", status=404)


async def _presign_artifact_row(row: dict, artifact_type: str, *, inline: bool = False) -> dict[str, Any]:
    _assert_bucket(row)
    head = head_object(str(row["s3_object_key"]))
    if not head:
        raise ArtifactStorageError("Artifact file is missing from storage.", status=404)
    name = "interview_report.pdf" if artifact_type == "report" else "transcript.json"
    mode = "inline" if inline else "attachment"
    ct = "application/pdf" if artifact_type == "report" else "application/json"
    signed = presign_download(str(row["s3_object_key"]), disposition=f'{mode}; filename="{name}"', content_type=ct)
    return {**signed, "contentType": ct, "filename": name, "sessionId": row.get("interview_id")}


async def persist_interview_report_pdf_to_s3(**opts: Any) -> dict[str, Any]:
    if not s3_storage_configured():
        raise ArtifactStorageError("Report storage is not configured (S3).", status=503, skipped=True)
    email = str(opts["requesterEmail"]).lower()
    session_id = str(opts.get("sessionId") or "")
    session = (opts["db"].get("interviewSessions") or {}).get(session_id)
    if not session or str(session.get("email") or "").lower() != email:
        raise ArtifactStorageError("Interview session not found.", status=404)
    raw = str(opts.get("fileBase64") or "")
    b64 = raw.split(",", 1)[1] if "," in raw else raw
    try:
        buf = base64.b64decode(b64, validate=True)
    except Exception as err:
        raise ArtifactStorageError("Invalid file_base64 for report PDF.", status=400) from err
    if len(buf) < 256:
        raise ArtifactStorageError("Report PDF is too small or empty.", status=400)
    if len(buf) > MAX_REPORT_BYTES:
        raise ArtifactStorageError(f"Report PDF exceeds {MAX_REPORT_BYTES} bytes.", status=413)
    if buf[:4] != b"%PDF":
        raise ArtifactStorageError("Report must be a PDF file.", status=400)
    tenant_id = resolve_tenant_id(user=opts.get("account"), session_organization_id=session.get("organizationId"))
    candidate_id = resolve_candidate_storage_id(account=opts.get("account"), session=session, email=email)
    object_key = build_interview_report_object_key(tenant_id=tenant_id, interview_id=session_id, candidate_id=candidate_id)
    bucket = s3_env()["bucket"]
    upload_object(key=object_key, body=buf, content_type="application/pdf")
    try:
        art_repo.upsert_interview_artifact(
            opts["pool"],
            {
                "tenantId": tenant_id,
                "interviewId": session_id,
                "candidateEmail": email,
                "artifactType": "report",
                "s3ObjectKey": object_key,
                "bucket": bucket,
                "contentType": "application/pdf",
                "byteSize": len(buf),
            },
        )
    except Exception as db_err:
        print("[interview-artifact] report metadata insert failed — run npm run db:init", db_err)
    return {"objectKey": object_key, "bucket": bucket}


async def persist_interview_transcript_to_s3(**opts: Any) -> dict[str, Any] | None:
    if not s3_storage_configured():
        return None
    email = str(opts.get("requesterEmail") or "").lower()
    session_id = str(opts.get("sessionId") or "")
    session = (opts.get("db") or {}).get("interviewSessions", {}).get(session_id)
    if not session or str(session.get("email") or "").lower() != email:
        raise ArtifactStorageError("Interview session not found.", status=404)
    tenant_id = resolve_tenant_id(user=opts.get("account"), session_organization_id=session.get("organizationId"))
    candidate_id = resolve_candidate_storage_id(account=opts.get("account"), session=session, email=email)
    object_key = build_interview_transcript_object_key(
        tenant_id=tenant_id,
        interview_id=session_id,
        candidate_id=candidate_id,
    )
    payload = {
        "sessionId": session_id,
        "tenantId": tenant_id,
        "candidateEmail": email,
        "completedAt": session.get("completedAt"),
        "questions": opts.get("questions") or [],
        "answers": opts.get("answers") or [],
        "resultSummary": {
            "overall": (opts.get("result") or {}).get("overall"),
            "role": (opts.get("result") or {}).get("role"),
            "level": (opts.get("result") or {}).get("level"),
        },
    }
    buf = json.dumps(payload, default=str).encode("utf-8")
    bucket = s3_env()["bucket"]
    upload_object(key=object_key, body=buf, content_type="application/json")
    if opts.get("pool"):
        try:
            art_repo.upsert_interview_artifact(
                opts["pool"],
                {
                    "tenantId": tenant_id,
                    "interviewId": session_id,
                    "candidateEmail": email,
                    "artifactType": "transcript",
                    "s3ObjectKey": object_key,
                    "bucket": bucket,
                    "contentType": "application/json",
                    "byteSize": len(buf),
                },
            )
        except Exception as db_err:
            print("[interview-artifact] transcript metadata insert failed", db_err)
    return {"objectKey": object_key, "bucket": bucket}


async def resolve_interview_artifact_download(**opts: Any) -> dict[str, Any]:
    bucket = active_s3_bucket_name()
    row = art_repo.get_interview_artifact(opts["pool"], str(opts["sessionId"]), str(opts["artifactType"]), bucket)
    if not art_repo.can_access_interview_artifact(opts["requesterEmail"], row):
        raise ArtifactStorageError("Artifact not found.", status=404)
    return await _presign_artifact_row(row, str(opts["artifactType"]), inline=bool(opts.get("inline")))


async def resolve_candidate_interview_report_download(**opts: Any) -> dict[str, Any]:
    bucket = active_s3_bucket_name()
    row = art_repo.get_latest_interview_artifact_for_candidate(opts["pool"], opts["candidateEmail"], "report", bucket)
    if not row:
        raise ArtifactStorageError("Interview report not found in storage.", status=404)
    return await _presign_artifact_row(row, "report", inline=opts.get("inline") is not False)
