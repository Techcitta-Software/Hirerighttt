"""
Single-table access patterns for HireRight DynamoDB (maps Neon/Postgres tables).

Every item includes:
  - pk, sk (required)
  - entity_type (string discriminator)
  - gsi1pk … gsi4pk optional (see neon_entity_map.md)
  - data (map) — JSONB-shaped payload mirroring Neon row columns not in keys
  - created_at, updated_at (ISO-8601 strings)
  - ttl (epoch seconds) when row is ephemeral (sessions, reset tokens, invites)
"""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any


def _norm_email(email: str) -> str:
    return (email or "").strip().lower()


def _norm_slug(slug: str) -> str:
    return (slug or "").strip().lower()


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def pk_user(user_id: str) -> str:
    return f"USER#{user_id}"


def pk_org(org_id: str) -> str:
    return f"ORG#{org_id}"


def pk_platform() -> str:
    return "PLATFORM"


def pk_email(email: str) -> str:
    return f"EMAIL#{_norm_email(email)}"


def pk_session_token(token: str) -> str:
    return f"SESSION#{token}"


def pk_reset_token_hash(token_hash: str) -> str:
    return f"RESET#{token_hash}"


def sk_meta() -> str:
    return "META"


def sk_profile() -> str:
    return "PROFILE"


def sk_member(user_id: str) -> str:
    return f"MEMBER#{user_id}"


def sk_invite(invite_id: str) -> str:
    return f"INVITE#{invite_id}"


def sk_job(job_id: str) -> str:
    return f"JOB#{job_id}"


def sk_application(app_id: str) -> str:
    return f"APP#{app_id}"


def sk_job_application(app_id: str) -> str:
    return f"JOBAPP#{app_id}"


def sk_interview_result() -> str:
    return "INTERVIEW_RESULT"


def sk_interview_history(history_id: str) -> str:
    return f"INTERVIEW_HIST#{history_id}"


def sk_interview_session(session_id: str) -> str:
    return f"INTERVIEW_SESS#{session_id}"


def sk_vault_candidate(vault_id: str) -> str:
    return f"VAULT#{vault_id}"


def sk_plan(plan_id: str) -> str:
    return f"PLAN#{plan_id}"


def sk_subscription() -> str:
    return "SUBSCRIPTION"


def sk_org_subscription() -> str:
    return "ORG_SUBSCRIPTION"


def sk_stored_file(file_id: str) -> str:
    return f"FILE#{file_id}"


def sk_recording(recording_id: str) -> str:
    return f"RECORDING#{recording_id}"


def sk_artifact(artifact_id: str) -> str:
    return f"ARTIFACT#{artifact_id}"


def sk_talent_profile() -> str:
    return "TALENT_PROFILE"


def sk_talent_access(user_id: str) -> str:
    return f"TALENT_ACCESS#{user_id}"


def sk_saved_search(search_id: str) -> str:
    return f"SAVED_SEARCH#{search_id}"


def sk_interview_invite(token: str) -> str:
    return f"INTERVITE#{token}"


def sk_role_skill(role_key: str) -> str:
    return f"ROLE_SKILL#{role_key}"


def sk_assessment(prefix: str, entity_id: str) -> str:
    return f"ASSESS#{prefix}#{entity_id}"


def gsi1_email_user(email: str, user_id: str) -> dict[str, str]:
    return {"gsi1pk": pk_email(email), "gsi1sk": pk_user(user_id)}


def gsi1_slug_org(slug: str, org_id: str) -> dict[str, str]:
    return {"gsi1pk": f"SLUG#{_norm_slug(slug)}", "gsi1sk": pk_org(org_id)}


def gsi2_share_job(shareable_code: str, job_id: str) -> dict[str, str]:
    code = (shareable_code or "").strip().upper()
    return {"gsi2pk": f"SHARE#{code}", "gsi2sk": sk_job(job_id)}


def gsi2_org_jobs(org_id: str, job_id: str, status: str = "") -> dict[str, str]:
    st = (status or "published").lower()
    return {"gsi2pk": pk_org(org_id), "gsi2sk": f"JOB#{st}#{job_id}"}


def gsi3_org_applications(org_id: str, app_id: str, applied_at: str = "") -> dict[str, str]:
    ts = applied_at or iso_now()
    return {"gsi3pk": pk_org(org_id), "gsi3sk": f"APP#{ts}#{app_id}"}


def gsi3_candidate_applications(email: str, app_id: str, created_at: str = "") -> dict[str, str]:
    ts = created_at or iso_now()
    return {"gsi3pk": pk_email(email), "gsi3sk": f"JOBAPP#{ts}#{app_id}"}


def gsi4_invite_token(token: str) -> dict[str, str]:
    return {"gsi4pk": f"INVTOKEN#{token}", "gsi4sk": "META"}


def gsi4_marketplace_talent(profile_visibility: str, user_id: str) -> dict[str, str]:
    vis = (profile_visibility or "marketplace").lower()
    return {"gsi4pk": f"TALENT#{vis}", "gsi4sk": f"USER#{user_id}"}


def audit_pk(org_id: str | None) -> str:
    return pk_org(org_id) if org_id else pk_platform()


def audit_sk(created_at: str, audit_id: str) -> str:
    return f"AUDIT#{created_at}#{audit_id}"


def audit_gsi1_org_time(org_id: str | None, created_at: str, audit_id: str) -> dict[str, str]:
    base = audit_pk(org_id)
    return {"gsi1pk": base, "gsi1sk": f"AUDIT#{created_at}#{audit_id}"}


def sanitize_item(item: dict[str, Any]) -> dict[str, Any]:
    """Boto3 Table resource requires Decimals instead of floats in nested maps."""
    return dynamo_safe(item)  # type: ignore[return-value]


def row_to_item(
    *,
    pk: str,
    sk: str,
    entity_type: str,
    data: dict[str, Any],
    gsi: dict[str, str] | None = None,
    ttl_epoch: int | None = None,
    created_at: str | None = None,
    updated_at: str | None = None,
) -> dict[str, Any]:
    item: dict[str, Any] = {
        "pk": pk,
        "sk": sk,
        "entity_type": entity_type,
        "data": dynamo_safe(data),
        "created_at": created_at or iso_now(),
        "updated_at": updated_at or iso_now(),
    }
    if gsi:
        item.update(gsi)
    if ttl_epoch is not None:
        item["ttl"] = ttl_epoch
    return item


def dynamo_safe(value: Any) -> Any:
    """Convert Python/Postgres values for DynamoDB (no raw floats; datetimes → ISO)."""
    if value is None:
        return None
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): dynamo_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [dynamo_safe(v) for v in value]
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, uuid.UUID):
        return str(value)
    return value


def neon_row_as_data(row: dict[str, Any], *, exclude: frozenset[str] | None = None) -> dict[str, Any]:
    skip = exclude or frozenset()
    out: dict[str, Any] = {}
    for key, val in row.items():
        if key in skip:
            continue
        safe = dynamo_safe(val)
        if safe is not None:
            out[key] = safe
    return out


def password_reset_token_hash(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def role_key_from_display(display_role: str) -> str:
    base = _SLUG_RE.sub("-", (display_role or "").strip().lower()).strip("-")
    return base or "unknown"