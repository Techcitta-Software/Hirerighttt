from __future__ import annotations

import os


def employer_can_review_recording(db: dict, organization_id: str, candidate_email: str, row: dict | None) -> bool:
    if not row or row.get("status") not in ("uploaded", "completed"):
        return False
    org_id = str(organization_id or "").strip()
    if not org_id:
        return False
    if str(row.get("tenant_id")) == org_id:
        return True
    platform = (os.environ.get("S3_DEFAULT_TENANT_ID") or "platform").strip() or "platform"
    if str(row.get("tenant_id")) != platform:
        return False
    from app.services.vendor.candidate_documents import assert_vendor_may_view_candidate_documents

    try:
        assert_vendor_may_view_candidate_documents(db, org_id, candidate_email, None)
        return True
    except Exception:
        return False


def can_review_recording(tenant_id: str, row: dict | None) -> bool:
    return bool(tenant_id and row and str(row.get("tenant_id")) == str(tenant_id))


def vendor_may_view_interview_session(session: dict | None, organization_id: str, candidate_email: str) -> bool:
    if not session:
        return False
    expected = str(candidate_email or "").strip().lower()
    session_email = str(session.get("email") or "").strip().lower()
    if not expected or session_email != expected:
        return False
    platform = (os.environ.get("S3_DEFAULT_TENANT_ID") or "platform").strip() or "platform"
    session_org = str(session.get("organizationId") or platform).strip()
    org_id = str(organization_id or "").strip()
    return session_org == org_id or session_org == platform
