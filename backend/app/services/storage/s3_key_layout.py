from __future__ import annotations

import os
import re

PLATFORM_TENANT_ID = (os.environ.get("S3_DEFAULT_TENANT_ID") or "platform").strip() or "platform"
USERS_PREFIX = "users"


def assert_writable_user_object_key(key: str) -> str:
    k = str(key or "").strip()
    if not k:
        raise ValueError("S3 object key is required.")
    if not k.startswith(f"{USERS_PREFIX}/"):
        raise ValueError("S3 object key must live under users/ (production layout).")
    if ".." in k or "//" in k:
        raise ValueError("S3 object key contains invalid path segments.")
    return k


def sanitize_path_segment(segment: str) -> str:
    out = re.sub(r"[^a-zA-Z0-9._-]+", "_", str(segment or "unknown").strip())
    out = re.sub(r"^_+|_+$", "", out)[:128]
    return out or "unknown"


def extension_from_filename(filename: str) -> str:
    base = re.sub(r"[^a-zA-Z0-9._-]", "_", str(filename or "file"))
    m = re.search(r"(\.[a-z0-9]{1,8})$", base, re.I)
    return m.group(1).lower() if m else ""


def resolve_tenant_id(*, user: dict | None = None, session_organization_id: str | None = None) -> str:
    if session_organization_id and str(session_organization_id).strip():
        return sanitize_path_segment(session_organization_id)
    org = (user or {}).get("primaryOrganizationId")
    if org and str(org).strip():
        return sanitize_path_segment(str(org))
    return sanitize_path_segment(PLATFORM_TENANT_ID)


def resolve_candidate_storage_id(*, account: dict | None = None, session: dict | None = None, email: str = "") -> str:
    if account and account.get("id"):
        return sanitize_path_segment(str(account["id"]))
    if session and session.get("userId"):
        return sanitize_path_segment(str(session["userId"]))
    safe = str(email or "").lower().replace("@", "_at_")
    return sanitize_path_segment(safe or "candidate")


def _user_folder(user_id: str) -> str:
    return f"{USERS_PREFIX}/{sanitize_path_segment(user_id or 'unknown')}"


def build_candidate_resume_object_key(*, candidate_id: str, filename: str, version_number: int = 1) -> str:
    ext = extension_from_filename(filename) or ".pdf"
    ver = f"_v{version_number}" if version_number and version_number > 1 else ""
    return f"{_user_folder(candidate_id)}/resume/resume{ver}{ext}"


def build_interview_recording_object_key(
    *,
    tenant_id: str = "",
    interview_id: str,
    candidate_id: str = "",
    original_filename: str = "",
    content_type: str = "",
) -> str:
    del tenant_id
    iid = sanitize_path_segment(interview_id)
    ext = extension_from_filename(original_filename)
    if not ext:
        ct = str(content_type or "").lower()
        ext = ".mp4" if "mp4" in ct else ".webm"
    return f"{_user_folder(candidate_id)}/video/{iid}{ext}"


def build_interview_report_object_key(*, tenant_id: str = "", interview_id: str, candidate_id: str = "") -> str:
    del tenant_id
    iid = sanitize_path_segment(interview_id)
    return f"{_user_folder(candidate_id)}/report/{iid}.pdf"


def build_interview_transcript_object_key(*, tenant_id: str = "", interview_id: str, candidate_id: str = "") -> str:
    del tenant_id
    iid = sanitize_path_segment(interview_id)
    return f"{_user_folder(candidate_id)}/transcript/{iid}.json"
