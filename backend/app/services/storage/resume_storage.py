from __future__ import annotations

import asyncio
import base64
import re
from typing import Any

from app.services.storage.s3_key_layout import (
    build_candidate_resume_object_key,
    key_belongs_to_candidate,
    resolve_candidate_storage_id,
)
from app.services.storage.s3_storage import object_storage_configured, presign_download, upload_object

MAX_RESUME_BYTES = 2_000_000
MAX_RESUME_BASE64_CHARS = (MAX_RESUME_BYTES * 4) // 3 + 8
RESUME_FILENAME_RE = re.compile(r"\.(pdf|docx|txt)$", re.I)
RESUME_DOWNLOAD_API_PATH = "/api/resume/download"


def parse_resume_upload_body(body: dict) -> dict[str, Any]:
    filename = str(body.get("filename") or "resume.pdf")[:200]
    raw = str(body.get("file_base64") or body.get("fileBase64") or "")
    if not raw or not RESUME_FILENAME_RE.search(filename):
        err = ValueError("Upload a PDF, DOCX, or TXT resume (filename + file_base64).")
        err.status = 400  # type: ignore[attr-defined]
        raise err
    b64 = raw.split(",", 1)[1] if "," in raw else raw
    if len(b64) > MAX_RESUME_BASE64_CHARS:  # refuse before decoding (memory)
        err = ValueError("Resume must be between 1 byte and 2 MB.")
        err.status = 400  # type: ignore[attr-defined]
        raise err
    try:
        buf = base64.b64decode(b64, validate=True)
    except (ValueError, TypeError) as exc:
        err = ValueError("The resume file could not be read. Upload it again.")
        err.status = 400  # type: ignore[attr-defined]
        raise err from exc
    if len(buf) < 1 or len(buf) > MAX_RESUME_BYTES:
        err = ValueError("Resume must be between 1 byte and 2 MB.")
        err.status = 400  # type: ignore[attr-defined]
        raise err
    return {"filename": filename, "buffer": buf, "contentType": body.get("contentType")}


_PDF_TYPE = "application/pdf"
_DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_DOC_TYPE = "application/msword"
_TXT_TYPE = "text/plain; charset=utf-8"
_RESUME_CONTENT_TYPES = frozenset({_PDF_TYPE, _DOCX_TYPE, _DOC_TYPE})


def infer_resume_content_type(filename: str, content_type: str | None = None) -> str:
    """The filename extension wins. A stored type is used only when it is already a resume type and matches that extension.

    text/plain and application/octet-stream must not label a .pdf or .docx (the browser then saves or shows the file as text).
    """
    name = (filename or "").strip().lower()
    if name.endswith(".pdf"):
        by_ext = _PDF_TYPE
    elif name.endswith(".docx"):
        by_ext = _DOCX_TYPE
    elif name.endswith(".doc"):
        by_ext = _DOC_TYPE
    elif name.endswith(".txt"):
        by_ext = _TXT_TYPE
    else:
        by_ext = ""
    stored = str(content_type or "").split(";", 1)[0].strip().lower()
    if by_ext:
        if stored == by_ext:
            return stored
        return by_ext
    if stored in _RESUME_CONTENT_TYPES:
        return stored
    return "application/octet-stream"


def stored_resume_filename(storage_key: str, resume_name: Any = None) -> str:
    """The download name always carries the stored file's real extension.

    The name used to default to "resume.pdf" (and a stale name could say .pdf for a .docx), so Word resumes were
    served as PDFs: the browser downloaded them instead of showing a preview.
    """
    match = re.search(r"\.(pdf|docx|txt)$", storage_key or "", re.I)
    ext = f".{match.group(1).lower()}" if match else ""
    name = re.sub(r'[\r\n"\\/]+', " ", str(resume_name or "")).strip()
    if not name:
        return f"resume{ext or '.pdf'}"
    if ext and not name.lower().endswith(ext):
        return re.sub(r"\.(pdf|docx?|txt)$", "", name, flags=re.I) + ext
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


async def resolve_resume_download_from_profile(
    profile: dict,
    _pool,
    *,
    inline: bool = False,
    owner_user_id: str | None = None,
    owner_email: str = "",
) -> dict[str, Any]:
    """Presign the stored resume of the profile's owner. The key must be inside the OWNER's users/<id>/resume/ folder:
    a resumeStoragePath pointing anywhere else (set by a client before V-02 was fixed) is treated as no file."""
    key = profile.get("resumeStoragePath")
    if not key or not key_belongs_to_candidate(str(key), user_id=owner_user_id, email=owner_email, kind="resume"):
        err = ValueError("No stored resume file for this account.")
        err.status = 404  # type: ignore[attr-defined]
        raise err
    name = stored_resume_filename(str(key), profile.get("resumeName"))
    stored_type = profile.get("resumeContentType") or profile.get("contentType")
    content_type = infer_resume_content_type(name, str(stored_type) if stored_type else None)
    mode = "inline" if inline else "attachment"
    signed = presign_download(
        str(key),
        disposition=f'{mode}; filename="{name}"',
        content_type=content_type,
    )
    return {**signed, "contentType": content_type, "filename": name}


async def resolve_resume_download_for_user(**opts) -> dict[str, Any]:
    return await resolve_resume_download_from_profile(
        opts.get("profile") or {},
        opts.get("pool"),
        inline=False,
        owner_user_id=opts.get("ownerUserId"),
        owner_email=str(opts.get("requesterEmail") or ""),
    )


def public_object_storage_error(err: Exception, fallback: str) -> str:
    """A message safe to show the client. Only errors we raised on purpose (they carry a status) are passed through;
    anything else (S3 / network / database exceptions) is logged and replaced by `fallback` (V-21)."""
    import logging

    if getattr(err, "status", None) and isinstance(err, (ValueError, RuntimeError)) and str(err):
        return str(err)
    logging.getLogger("hireright.storage").warning("object storage error: %s", err, exc_info=err)
    return fallback
