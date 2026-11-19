from __future__ import annotations

import asyncio
import base64
import re
from typing import Any

from app.services.storage.s3_key_layout import (
    build_candidate_resume_object_key,
    resolve_candidate_storage_id,
)
from app.services.storage.s3_storage import object_storage_configured, presign_download, upload_object

MAX_RESUME_BYTES = 2_000_000
RESUME_FILENAME_RE = re.compile(r"\.(pdf|docx)$", re.I)
RESUME_DOWNLOAD_API_PATH = "/api/resume/download"


def parse_resume_upload_body(body: dict) -> dict[str, Any]:
    filename = str(body.get("filename") or "resume.pdf")[:200]
    raw = str(body.get("file_base64") or body.get("fileBase64") or "")
    if not raw or not RESUME_FILENAME_RE.search(filename):
        err = ValueError("Upload a PDF or DOCX resume (filename + file_base64).")
        err.status = 400  # type: ignore[attr-defined]
        raise err
    b64 = raw.split(",", 1)[1] if "," in raw else raw
    buf = base64.b64decode(b64, validate=True)
    if len(buf) < 1 or len(buf) > MAX_RESUME_BYTES:
        err = ValueError("Resume must be between 1 byte and 2 MB.")
        err.status = 400  # type: ignore[attr-defined]
        raise err
    return {"filename": filename, "buffer": buf, "contentType": body.get("contentType")}


def infer_resume_content_type(filename: str, content_type: str | None = None) -> str:
    if content_type:
        return content_type
    if filename.lower().endswith(".pdf"):
        return "application/pdf"
    if filename.lower().endswith(".docx"):
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    return "application/octet-stream"


def stored_resume_filename(storage_key: str, resume_name: Any = None) -> str:
    """The download name always carries the stored file's real extension.

    The name used to default to "resume.pdf" (and a stale name could say .pdf for a .docx), so Word resumes were
    served as PDFs: the browser downloaded them instead of showing a preview.
    """
    match = re.search(r"\.(pdf|docx)$", storage_key or "", re.I)
    ext = f".{match.group(1).lower()}" if match else ""
    name = re.sub(r'[\r\n"\\/]+', " ", str(resume_name or "")).strip()
    if not name:
        return f"resume{ext or '.pdf'}"
    if ext and not name.lower().endswith(ext):
        return re.sub(r"\.(pdf|docx?)$", "", name, flags=re.I) + ext
    return name


async def upload_resume_to_object_storage(**opts) -> dict[str, Any]:
    if not object_storage_configured():
        err = RuntimeError("Object storage is not configured (S3).")
        err.status = 503  # type: ignore[attr-defined]
        err.skipped = True  # type: ignore[attr-defined]
        raise err
    email = str(opts["candidateEmail"]).lower()
    filename = opts["filename"]
    buf = opts["buffer"]
    content_type = infer_resume_content_type(filename, opts.get("contentType"))
    account = {"id": opts.get("ownerUserId")} if opts.get("ownerUserId") else None
    candidate_id = resolve_candidate_storage_id(account=account, email=email)
    key = build_candidate_resume_object_key(candidate_id=candidate_id, filename=filename)
    # S3 PUT off the event loop (a 0.3-1 s network call)
    uploaded = await asyncio.to_thread(upload_object, key=key, body=buf, content_type=content_type)
    return {
        "storageProvider": "s3",
        "bucket": uploaded["bucket"],
        "storagePath": key,
        "fileId": None,
        "resumeUrl": RESUME_DOWNLOAD_API_PATH,
    }


async def resolve_resume_download_from_profile(profile: dict, _pool, *, inline: bool = False) -> dict[str, Any]:
    key = profile.get("resumeStoragePath")
    if not key:
        err = ValueError("No stored resume file for this account.")
        err.status = 404  # type: ignore[attr-defined]
        raise err
    name = stored_resume_filename(str(key), profile.get("resumeName"))
    mode = "inline" if inline else "attachment"
    signed = presign_download(str(key), disposition=f'{mode}; filename="{name}"')
    return {**signed, "contentType": infer_resume_content_type(name), "filename": name}


async def resolve_resume_download_for_user(**opts) -> dict[str, Any]:
    return await resolve_resume_download_from_profile(opts.get("profile") or {}, opts.get("pool"), inline=False)


def public_object_storage_error(err: Exception, fallback: str) -> str:
    return str(err) if str(err) else fallback
