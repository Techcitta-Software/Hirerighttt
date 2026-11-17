"""DynamoDB repositories — sole persistence when DATABASE_PROVIDER=dynamodb."""

from __future__ import annotations

import json
import secrets
import uuid
from datetime import datetime, timezone
from typing import Any, Iterable

import boto3

from app.db.dynamo.key_patterns import (
    audit_gsi1_org_time,
    audit_pk,
    audit_sk,
    gsi1_email_user,
    gsi1_slug_org,
    gsi4_invite_token,
    gsi4_marketplace_talent,
    neon_row_as_data,
    pk_email,
    pk_org,
    pk_platform,
    pk_reset_token_hash,
    pk_session_token,
    pk_user,
    row_to_item,
    sanitize_item,
    sk_artifact,
    sk_assessment,
    sk_interview_history,
    sk_interview_result,
    sk_interview_session,
    sk_interview_invite,
    sk_member,
    sk_meta,
    sk_recording,
    sk_stored_file,
    sk_subscription,
    sk_talent_access,
    sk_talent_profile,
)
from app.db.dynamo.table_specs import AUDIT_TABLE, MAIN_TABLE, physical_table_name
from app.db.dynamo_config import dynamo_resource_kwargs
from app.db.dynamo_relational import _from_dynamo, _table as main_table


def _audit_table():
    return boto3.resource("dynamodb", **dynamo_resource_kwargs()).Table(physical_table_name(AUDIT_TABLE.logical_name))


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _put(item: dict[str, Any], *, audit: bool = False) -> None:
    tbl = _audit_table() if audit else main_table()
    tbl.put_item(Item=sanitize_item(item))


def _scan_entity(entity_type: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    kwargs: dict[str, Any] = {
        "FilterExpression": "entity_type = :et",
        "ExpressionAttributeValues": {":et": entity_type},
    }
    while True:
        resp = main_table().scan(**kwargs)
        for raw in resp.get("Items", []):
            item = _from_dynamo(raw)
            data = dict(item.get("data") or {})
            for k in ("pk", "sk", "entity_type", "gsi1pk", "gsi1sk", "gsi2pk", "gsi2sk", "gsi3pk", "gsi3sk", "gsi4pk", "gsi4sk"):
                data.pop(k, None)
            items.append(data)
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    return items


def _query_pk(pk: str, sk_prefix: str | None = None) -> list[dict[str, Any]]:
    kwargs: dict[str, Any] = {
        "KeyConditionExpression": "pk = :pk",
        "ExpressionAttributeValues": {":pk": pk},
    }
    if sk_prefix:
        kwargs["KeyConditionExpression"] += " AND begins_with(sk, :pfx)"
        kwargs["ExpressionAttributeValues"][":pfx"] = sk_prefix
    items: list[dict[str, Any]] = []
    while True:
        resp = main_table().query(**kwargs)
        for raw in resp.get("Items", []):
            items.append(_from_dynamo(raw))
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    return items


def _gsi4_invite(token: str) -> dict[str, Any] | None:
    resp = main_table().query(
        IndexName="Gsi4",
        KeyConditionExpression="gsi4pk = :g AND gsi4sk = :s",
        ExpressionAttributeValues={":g": f"INVTOKEN#{token}", ":s": "META"},
        Limit=1,
    )
    items = resp.get("Items") or []
    return _from_dynamo(items[0]) if items else None


# --- Account registration -----------------------------------------------------

def register_account_dynamo(input: dict) -> dict:
    """Atomic signup when DATABASE_PROVIDER=dynamodb (mirrors auth_register.register_account)."""
    from app.auth_register import UniqueAccountError
    from app.db.dynamo_relational import load_db_dynamo
    from app.db.saas_helpers import unique_org_slug

    db = load_db_dynamo()
    email = str(input["email"]).strip().lower()
    phone = str(input.get("phone") or "").strip()
    for u in db.get("users") or []:
        if str(u.get("email") or "").lower() == email:
            raise UniqueAccountError(
                "email",
                "An account with this email already exists.",
            )
        if phone and str(u.get("phone") or "").strip() == phone:
            raise UniqueAccountError("phone", "An account with this mobile number already exists.")

    user = {
        "id": input["id"],
        "email": email,
        "name": input["name"],
        "passwordHash": input["passwordHash"],
        "role": "employer" if input["role"] == "employer" else "jobseeker",
        "companyName": input.get("companyName") if input["role"] == "employer" else None,
        "primaryOrganizationId": None,
        "status": "active",
        "phone": phone or None,
        "createdAt": input["createdAt"],
    }
    data = neon_row_as_data(
        {
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "password_hash": user["passwordHash"],
            "role": user["role"],
            "company_name": user.get("companyName"),
            "primary_organization_id": user.get("primaryOrganizationId"),
            "status": user["status"],
            "phone": user.get("phone"),
            "created_at": user["createdAt"],
        }
    )
    _put(
        row_to_item(
            pk=pk_user(user["id"]),
            sk=sk_meta(),
            entity_type="user",
            data=data,
            gsi=gsi1_email_user(user["email"], user["id"]),
            created_at=user["createdAt"],
        )
    )

    if input["role"] != "employer":
        return {"user": user}

    org_id = secrets.token_hex(8)
    org_name = (input.get("companyName") or "").strip() or f"{input['name'].split(' ')[0]}'s Team"
    slug = unique_org_slug(org_name, [{"slug": o.get("slug")} for o in db.get("organizations") or []])
    now = input["createdAt"]
    trial_ends = datetime.now(timezone.utc).timestamp() + 14 * 86400
    trial_iso = datetime.fromtimestamp(trial_ends, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    org_data = neon_row_as_data(
        {
            "id": org_id,
            "name": org_name,
            "slug": slug,
            "billing_email": email,
            "status": "active",
            "settings": {},
            "created_at": now,
            "updated_at": now,
        }
    )
    _put(
        row_to_item(
            pk=pk_org(org_id),
            sk=sk_meta(),
            entity_type="organization",
            data=org_data,
            gsi=gsi1_slug_org(slug, org_id),
            created_at=now,
            updated_at=now,
        )
    )
    member_id = secrets.token_hex(8)
    member_data = neon_row_as_data(
        {
            "id": member_id,
            "organization_id": org_id,
            "user_id": user["id"],
            "role": "owner",
            "joined_at": now,
        }
    )
    _put(
        row_to_item(
            pk=pk_org(org_id),
            sk=sk_member(user["id"]),
            entity_type="organization_member",
            data=member_data,
        )
    )
    sub_id = secrets.token_hex(8)
    sub_data = neon_row_as_data(
        {
            "id": sub_id,
            "organization_id": org_id,
            "plan_id": "plan-starter",
            "status": "trialing",
            "trial_ends_at": trial_iso,
            "created_at": now,
            "updated_at": now,
        }
    )
    _put(
        row_to_item(
            pk=pk_org(org_id),
            sk=sk_subscription(),
            entity_type="organization_subscription",
            data=sub_data,
        )
    )
    user["primaryOrganizationId"] = org_id
    user["companyName"] = org_name
    data["primary_organization_id"] = org_id
    data["company_name"] = org_name
    _put(
        row_to_item(
            pk=pk_user(user["id"]),
            sk=sk_meta(),
            entity_type="user",
            data=data,
            gsi=gsi1_email_user(user["email"], user["id"]),
            created_at=user["createdAt"],
        )
    )
    return {
        "user": user,
        "organization": {"id": org_id, "name": org_name, "slug": slug},
    }


# --- Sessions -----------------------------------------------------------------

def save_session_token_dynamo(token: str, email: str, ttl_ms: int = 7 * 24 * 60 * 60 * 1000) -> None:
    expires = int(datetime.now(timezone.utc).timestamp() + ttl_ms / 1000)
    data = {"token": token, "email": email, "expires_at": datetime.fromtimestamp(expires, tz=timezone.utc).isoformat()}
    _put(
        row_to_item(
            pk=pk_session_token(token),
            sk=sk_meta(),
            entity_type="hireright_session",
            data=neon_row_as_data(data),
            gsi=gsi1_email_user(email, token),
            ttl_epoch=expires,
        )
    )


def resolve_session_email_dynamo(token: str) -> str | None:
    if not token:
        return None
    resp = main_table().get_item(Key={"pk": pk_session_token(token), "sk": sk_meta()})
    item = resp.get("Item")
    if not item:
        return None
    row = _from_dynamo(item)
    data = row.get("data") or {}
    exp = data.get("expires_at")
    if not exp:
        return str(data.get("email") or "")
    exp_dt = datetime.fromisoformat(str(exp).replace("Z", "+00:00"))
    if exp_dt.timestamp() <= datetime.now(timezone.utc).timestamp():
        return None
    return str(data.get("email") or "")


def delete_session_token_dynamo(token: str) -> None:
    if token:
        main_table().delete_item(Key={"pk": pk_session_token(token), "sk": sk_meta()})


def delete_sessions_for_email_dynamo(email: str) -> None:
    for item in _scan_entity("hireright_session"):
        if str(item.get("email") or "").lower() == email.lower():
            tok = item.get("token")
            if tok:
                delete_session_token_dynamo(tok)


# --- Password reset -----------------------------------------------------------

def store_reset_token_dynamo(email: str, token: str, ip: str | None) -> None:
    import hashlib

    expires = datetime.now(timezone.utc).timestamp() + 30 * 60
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    for old in _scan_entity("password_reset_token"):
        if old.get("email") == email and not old.get("used_at"):
            old_hash = old.get("token_hash")
            if old_hash:
                main_table().delete_item(Key={"pk": pk_reset_token_hash(old_hash), "sk": sk_meta()})
    data = neon_row_as_data(
        {
            "token_hash": token_hash,
            "email": email,
            "expires_at": datetime.fromtimestamp(expires, tz=timezone.utc).isoformat(),
            "requested_ip": ip,
            "used_at": None,
        }
    )
    _put(
        row_to_item(
            pk=pk_reset_token_hash(token_hash),
            sk=sk_meta(),
            entity_type="password_reset_token",
            data=data,
            ttl_epoch=int(expires),
        )
    )


def consume_reset_token_dynamo(token: str) -> str | None:
    import hashlib

    th = hashlib.sha256(token.encode("utf-8")).hexdigest()
    key = {"pk": pk_reset_token_hash(th), "sk": sk_meta()}
    resp = main_table().get_item(Key=key)
    item = resp.get("Item")
    if not item:
        return None
    row = _from_dynamo(item)
    data = row.get("data") or {}
    if data.get("used_at"):
        return None
    exp = data.get("expires_at")
    if exp and datetime.fromisoformat(str(exp).replace("Z", "+00:00")).timestamp() <= datetime.now(timezone.utc).timestamp():
        return None
    data["used_at"] = _iso_now()
    _put(row_to_item(pk=key["pk"], sk=key["sk"], entity_type="password_reset_token", data=data))
    return str(data.get("email") or "")


# --- Interview invites --------------------------------------------------------

def insert_interview_invite_dynamo(row: dict[str, Any]) -> None:
    token = row["token"]
    oid = row.get("organizationId") or row.get("organization_id")
    pk = pk_org(oid) if oid else pk_email(str(row["candidateEmail"]))
    data = neon_row_as_data(
        {
            "token": token,
            "organization_id": oid,
            "application_id": row.get("applicationId"),
            "job_id": row.get("jobId"),
            "candidate_email": row["candidateEmail"],
            "candidate_name": row.get("candidateName"),
            "job_title": row.get("jobTitle"),
            "scheduled_start": row["scheduledStart"],
            "scheduled_end": row["scheduledEnd"],
            "created_by_user_id": row.get("createdByUserId"),
            "email_sent_at": row.get("emailSentAt"),
            "context_json": row.get("contextJson") or {},
        }
    )
    _put(
        row_to_item(
            pk=pk,
            sk=sk_interview_invite(token),
            entity_type="interview_invite",
            data=data,
            gsi=gsi4_invite_token(token),
        )
    )


def get_interview_invite_dynamo(token: str) -> dict | None:
    hit = _gsi4_invite(token)
    if not hit:
        for row in _scan_entity("interview_invite"):
            if row.get("token") == token:
                return _invite_row_to_api(row)
        return None
    data = hit.get("data") or {}
    return _invite_row_to_api(data)


def update_invite_email_sent_dynamo(token: str) -> None:
    inv = get_interview_invite_dynamo(token)
    if not inv:
        return
    inv["email_sent_at"] = _iso_now()
    insert_interview_invite_dynamo(
        {
            "token": token,
            "organizationId": inv.get("organization_id"),
            "applicationId": inv.get("application_id"),
            "jobId": inv.get("job_id"),
            "candidateEmail": inv.get("candidate_email"),
            "candidateName": inv.get("candidate_name"),
            "jobTitle": inv.get("job_title"),
            "scheduledStart": inv.get("scheduled_start"),
            "scheduledEnd": inv.get("scheduled_end"),
            "createdByUserId": inv.get("created_by_user_id"),
            "emailSentAt": inv["email_sent_at"],
            "contextJson": inv.get("context_json") or {},
        }
    )


def _invite_row_to_api(row: dict) -> dict:
    ctx = row.get("context_json") or {}
    if isinstance(ctx, str):
        try:
            ctx = json.loads(ctx)
        except Exception:
            ctx = {}
    return {**row, "context_json": ctx}


def list_interview_invites_dynamo() -> list[dict]:
    return [_invite_row_to_api(r) for r in _scan_entity("interview_invite")]


def reschedule_invite_dynamo(token: str, start: datetime, end: datetime) -> None:
    inv = get_interview_invite_dynamo(token)
    if not inv:
        return
    count = int(inv.get("reschedule_count") or 0) + 1
    insert_interview_invite_dynamo(
        {
            "token": token,
            "organizationId": inv.get("organization_id"),
            "applicationId": inv.get("application_id"),
            "jobId": inv.get("job_id"),
            "candidateEmail": inv.get("candidate_email"),
            "candidateName": inv.get("candidate_name"),
            "jobTitle": inv.get("job_title"),
            "scheduledStart": start.isoformat(),
            "scheduledEnd": end.isoformat(),
            "createdByUserId": inv.get("created_by_user_id"),
            "emailSentAt": inv.get("email_sent_at"),
            "contextJson": inv.get("context_json") or {},
        }
    )
    hit = _gsi4_invite(token)
    if hit:
        data = hit.get("data") or {}
        data["reschedule_count"] = count
        data["reminder_24h_sent_at"] = None
        data["reminder_2h_sent_at"] = None
        _put(row_to_item(pk=hit["pk"], sk=hit["sk"], entity_type="interview_invite", data=neon_row_as_data(data), gsi=gsi4_invite_token(token)))


# --- Audit --------------------------------------------------------------------

def audit_record_dynamo(
    action: str,
    *,
    user_id: str | None = None,
    organization_id: str | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    meta: dict | None = None,
) -> None:
    aid = str(uuid.uuid4())
    created = _iso_now()
    data = neon_row_as_data(
        {
            "id": aid,
            "organization_id": organization_id,
            "user_id": user_id,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "meta": meta or {},
            "created_at": created,
        }
    )
    _put(
        row_to_item(
            pk=audit_pk(organization_id),
            sk=audit_sk(created, aid),
            entity_type="audit_log",
            data=data,
            gsi=audit_gsi1_org_time(organization_id, created, aid),
        ),
        audit=True,
    )


# --- Talent -------------------------------------------------------------------

def upsert_talent_profile_dynamo(row: dict[str, Any]) -> None:
    uid = row["userId"]
    data = neon_row_as_data(
        {
            "user_id": uid,
            "email": row["email"],
            "full_name": row["fullName"],
            "role_title": row.get("currentRole"),
            "location": row.get("location"),
            "experience_years": row.get("experienceYears"),
            "skills": row.get("skills") or [],
            "summary": row.get("summary"),
            "resume_snippet": row.get("resumeSnippet"),
            "interview_score": row.get("interviewScore"),
            "profile_visibility": row.get("profileVisibility") or "marketplace",
            "updated_at": _iso_now(),
        }
    )
    vis = data.get("profile_visibility") or "marketplace"
    _put(
        row_to_item(
            pk=pk_user(uid),
            sk=sk_talent_profile(),
            entity_type="talent_profile",
            data=data,
            gsi=gsi4_marketplace_talent(vis, uid),
        )
    )


def grant_talent_access_dynamo(org_id: str, user_id: str, access_type: str = "application") -> None:
    data = neon_row_as_data(
        {"organization_id": org_id, "user_id": user_id, "access_type": access_type, "granted_at": _iso_now()}
    )
    _put(
        row_to_item(
            pk=pk_org(org_id),
            sk=sk_talent_access(user_id),
            entity_type="talent_access",
            data=data,
        )
    )


def _talent_candidates() -> list[dict[str, Any]]:
    return _scan_entity("talent_profile")


def _talent_access_for_org(org_id: str) -> set[str]:
    return {
        str((_from_dynamo(i).get("data") or {}).get("user_id"))
        for i in _query_pk(pk_org(org_id), "TALENT_ACCESS#")
    }


def search_talent_dynamo(organization_id: str, filters: dict | None = None) -> dict:
    filters = filters or {}
    limit = min(max(int(filters.get("limit") or 25), 1), 100)
    offset = max(int(filters.get("offset") or 0), 0)
    q = str(filters.get("q") or "").strip().lower()
    access = _talent_access_for_org(organization_id)
    rows = []
    for t in _talent_candidates():
        vis = t.get("profile_visibility") or "marketplace"
        uid = t.get("user_id")
        if vis == "private":
            continue
        if vis != "marketplace" and uid not in access:
            continue
        if filters.get("minScore") is not None and (t.get("interview_score") or 0) < filters["minScore"]:
            continue
        if filters.get("location") and filters["location"].lower() not in str(t.get("location") or "").lower():
            continue
        if q:
            blob = " ".join(
                [
                    str(t.get("full_name") or ""),
                    str(t.get("role_title") or ""),
                    str(t.get("resume_snippet") or "")[:500],
                    " ".join(t.get("skills") or []),
                ]
            ).lower()
            if q not in blob:
                continue
        rows.append(t)
    rows.sort(key=lambda r: (r.get("interview_score") or 0, r.get("updated_at") or ""), reverse=True)
    page = rows[offset : offset + limit]
    return {
        "total": len(rows),
        "candidates": [
            {
                "userId": r["user_id"],
                "email": r["email"],
                "fullName": r.get("full_name"),
                "currentRole": r.get("role_title"),
                "location": r.get("location"),
                "experienceYears": r.get("experience_years"),
                "skills": r.get("skills") or [],
                "summary": r.get("summary"),
                "resumePreview": (r.get("resume_snippet") or "")[:500],
                "interviewScore": r.get("interview_score"),
                "profileVisibility": r.get("profile_visibility"),
                "updatedAt": r.get("updated_at"),
                "rank": 0,
            }
            for r in page
        ],
    }


def get_talent_by_id_dynamo(organization_id: str, user_id: str) -> dict | None:
    resp = main_table().get_item(Key={"pk": pk_user(user_id), "sk": sk_talent_profile()})
    if not resp.get("Item"):
        return None
    t = _from_dynamo(resp["Item"]).get("data") or {}
    vis = t.get("profile_visibility") or "marketplace"
    if vis == "private":
        return None
    if vis != "marketplace" and user_id not in _talent_access_for_org(organization_id):
        return None
    return {
        "userId": t["user_id"],
        "email": t["email"],
        "fullName": t.get("full_name"),
        "currentRole": t.get("role_title"),
        "location": t.get("location"),
        "experienceYears": t.get("experience_years"),
        "skills": t.get("skills") or [],
        "summary": t.get("summary"),
        "resumeSnippet": t.get("resume_snippet"),
        "interviewScore": t.get("interview_score"),
        "profileVisibility": t.get("profile_visibility"),
        "updatedAt": t.get("updated_at"),
    }


# --- File metadata ------------------------------------------------------------

def insert_recording_dynamo(row: dict[str, Any]) -> str:
    rec_id = str(uuid.uuid4())
    tenant = row["tenantId"]
    data = neon_row_as_data(
        {
            "id": rec_id,
            "tenant_id": tenant,
            "interview_id": row["interviewId"],
            "candidate_id": row.get("candidateId"),
            "candidate_email": row["candidateEmail"],
            "s3_object_key": row["s3ObjectKey"],
            "bucket": row.get("bucket"),
            "original_filename": row["originalFilename"],
            "content_type": row["contentType"],
            "file_size_bytes": row.get("fileSizeBytes"),
            "duration_seconds": row.get("durationSeconds"),
            "status": row.get("status") or "pending",
            "created_at": _iso_now(),
            "updated_at": _iso_now(),
        }
    )
    _put(
        row_to_item(
            pk=f"TENANT#{tenant}",
            sk=sk_recording(rec_id),
            entity_type="interview_recording",
            data=data,
        )
    )
    return rec_id


def get_recording_dynamo(rec_id: str) -> dict | None:
    for r in _scan_entity("interview_recording"):
        if r.get("id") == rec_id:
            return _recording_api(r)
    return None


def _recording_api(r: dict) -> dict:
    return {
        "id": r["id"],
        "tenant_id": r.get("tenant_id"),
        "interview_id": r.get("interview_id"),
        "candidate_id": r.get("candidate_id"),
        "candidate_email": r.get("candidate_email"),
        "s3_object_key": r.get("s3_object_key"),
        "bucket": r.get("bucket"),
        "original_filename": r.get("original_filename"),
        "content_type": r.get("content_type"),
        "file_size_bytes": r.get("file_size_bytes"),
        "duration_seconds": r.get("duration_seconds"),
        "status": r.get("status"),
        "created_at": r.get("created_at"),
        "updated_at": r.get("updated_at"),
    }


def update_recording_dynamo(rec_id: str, patch: dict[str, Any]) -> None:
    r = get_recording_dynamo(rec_id)
    if not r:
        return
    # Update the SAME item (same id / sort key). Re-inserting created a second record under a new id and left the
    # original stuck at "pending", so a finished upload never showed as uploaded.
    if patch.get("status"):
        r["status"] = patch["status"]
    if patch.get("fileSizeBytes") is not None:
        r["file_size_bytes"] = patch["fileSizeBytes"]
    if patch.get("durationSeconds") is not None:
        r["duration_seconds"] = patch["durationSeconds"]
    r["updated_at"] = _iso_now()
    _put(
        row_to_item(
            pk=f"TENANT#{r['tenant_id']}",
            sk=sk_recording(rec_id),
            entity_type="interview_recording",
            data=neon_row_as_data(r),
        )
    )


def purge_candidate_interview_data_dynamo(email: str, *, session_ids: Iterable[str] = (), delete_object=None) -> dict[str, int]:
    """Remove a candidate's recordings, artifacts, interview result and sessions (used when they replace their resume)."""
    em = email.strip().lower()
    recordings = artifacts = 0
    for r in _scan_entity("interview_recording"):
        if str(r.get("candidate_email") or "").lower() != em or not r.get("id") or not r.get("tenant_id"):
            continue
        if r.get("status") in ("uploaded", "completed", "ready"):
            recordings += 1
            if delete_object and r.get("s3_object_key"):
                delete_object(str(r["s3_object_key"]))
        main_table().delete_item(Key={"pk": f"TENANT#{r['tenant_id']}", "sk": sk_recording(str(r["id"]))})
    for a in _scan_entity("interview_artifact"):
        if str(a.get("candidate_email") or "").lower() != em or not a.get("tenant_id"):
            continue
        if a.get("status") == "ready":
            artifacts += 1
            if delete_object and a.get("s3_object_key"):
                delete_object(str(a["s3_object_key"]))
        main_table().delete_item(
            Key={"pk": f"TENANT#{a['tenant_id']}", "sk": sk_artifact(f"{a.get('interview_id')}#{a.get('artifact_type')}")}
        )
    main_table().delete_item(Key={"pk": pk_email(em), "sk": sk_interview_result()})
    for sid in session_ids:
        main_table().delete_item(Key={"pk": pk_email(em), "sk": sk_interview_session(str(sid))})
    return {"recordings": recordings, "artifacts": artifacts}


def upsert_artifact_dynamo(row: dict[str, Any]) -> str:
    rec_id = str(uuid.uuid4())
    tenant = row["tenantId"]
    data = neon_row_as_data(
        {
            "id": rec_id,
            "tenant_id": tenant,
            "interview_id": row["interviewId"],
            "candidate_email": row["candidateEmail"],
            "artifact_type": row["artifactType"],
            "s3_object_key": row["s3ObjectKey"],
            "bucket": row.get("bucket"),
            "content_type": row["contentType"],
            "byte_size": row.get("byteSize"),
            "status": "ready",
            "created_at": _iso_now(),
            "updated_at": _iso_now(),
        }
    )
    _put(
        row_to_item(
            pk=f"TENANT#{tenant}",
            sk=sk_artifact(f"{row['interviewId']}#{row['artifactType']}"),
            entity_type="interview_artifact",
            data=data,
        )
    )
    return rec_id


def get_artifact_dynamo(interview_id: str, artifact_type: str, active_bucket: str | None = None) -> dict | None:
    for a in _scan_entity("interview_artifact"):
        if a.get("interview_id") == interview_id and a.get("artifact_type") == artifact_type:
            if active_bucket and a.get("bucket") != active_bucket:
                continue
            return _artifact_api(a)
    return None


def _artifact_api(a: dict) -> dict:
    return {
        "id": a.get("id"),
        "tenant_id": a.get("tenant_id"),
        "interview_id": a.get("interview_id"),
        "candidate_email": a.get("candidate_email"),
        "artifact_type": a.get("artifact_type"),
        "s3_object_key": a.get("s3_object_key"),
        "bucket": a.get("bucket"),
        "content_type": a.get("content_type"),
        "byte_size": a.get("byte_size"),
        "status": a.get("status"),
    }


def get_latest_artifact_for_candidate_dynamo(email: str, artifact_type: str, active_bucket: str | None = None) -> dict | None:
    em = email.strip().lower()
    hits = [
        a
        for a in _scan_entity("interview_artifact")
        if str(a.get("candidate_email") or "").lower() == em and a.get("artifact_type") == artifact_type
    ]
    if active_bucket:
        hits = [h for h in hits if h.get("bucket") == active_bucket]
    if not hits:
        return None
    hits.sort(key=lambda x: x.get("updated_at") or x.get("created_at") or "", reverse=True)
    return _artifact_api(hits[0])


def upsert_stored_file_dynamo(row: dict[str, Any]) -> None:
    file_id = row.get("id") or str(uuid.uuid4())
    owner = str(row.get("owner_email") or row.get("ownerEmail") or "").lower()
    data = neon_row_as_data({**row, "id": file_id})
    pk = pk_user(row["owner_user_id"]) if row.get("owner_user_id") else pk_email(owner)
    _put(row_to_item(pk=pk, sk=sk_stored_file(file_id), entity_type="stored_file", data=data))


def append_interview_history_dynamo(email: str, data: dict, ctx: dict | None = None) -> None:
    hid = str(uuid.uuid4())
    data_row = neon_row_as_data(
        {
            "id": hid,
            "email": email,
            "user_id": (ctx or {}).get("userId"),
            "organization_id": (ctx or {}).get("organizationId"),
            "job_id": (ctx or {}).get("jobId"),
            "overall": data.get("overall") if isinstance(data, dict) else None,
            "data": data,
            "created_at": _iso_now(),
        }
    )
    _put(
        row_to_item(
            pk=pk_email(email),
            sk=sk_interview_history(hid),
            entity_type="interview_result_history",
            data=data_row,
        )
    )


# --- Assessment entities (query by type + id) ----------------------------------

def _assess_all(prefix: str) -> list[dict]:
    out: list[dict] = []
    kwargs: dict[str, Any] = {
        "FilterExpression": "begins_with(sk, :p)",
        "ExpressionAttributeValues": {":p": f"ASSESS#{prefix}#"},
    }
    while True:
        resp = main_table().scan(**kwargs)
        for raw in resp.get("Items", []):
            out.append(_from_dynamo(raw).get("data") or {})
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    return out


def assess_get(table: str, id_val: str) -> dict | None:
    prefix_map = {
        "assessment_jobs": "JOB",
        "assessment_resumes": "RESUME",
        "interview_plans": "PLAN",
        "assessment_sessions": "SESSION",
        "interview_questions": "QUESTION",
        "interview_answers": "ANSWER",
        "answer_evaluations": "EVAL",
        "interview_reports": "REPORT",
    }
    pfx = prefix_map.get(table, "GEN")
    for row in _assess_all(pfx):
        if str(row.get("id") or row.get("session_id")) == str(id_val):
            return row
    return None


def assess_list(table: str, **filters) -> list[dict]:
    prefix_map = {
        "interview_questions": "QUESTION",
        "interview_answers": "ANSWER",
        "answer_evaluations": "EVAL",
    }
    pfx = prefix_map.get(table, "GEN")
    rows = _assess_all(pfx)
    for key, val in filters.items():
        rows = [r for r in rows if str(r.get(key)) == str(val)]
    return rows


def assess_put(table: str, row: dict, *, org_id: str | None = None, user_id: str | None = None) -> None:
    prefix_map = {
        "assessment_jobs": "JOB",
        "assessment_resumes": "RESUME",
        "interview_plans": "PLAN",
        "assessment_sessions": "SESSION",
        "interview_questions": "QUESTION",
        "interview_answers": "ANSWER",
        "answer_evaluations": "EVAL",
        "interview_reports": "REPORT",
        "assessment_usage": "USAGE",
        "assessment_events": "EVENT",
    }
    pfx = prefix_map.get(table, "GEN")
    eid = str(row.get("id") or row.get("session_id") or row.get("question_id") or uuid.uuid4())
    pk = pk_org(org_id) if org_id else pk_user(str(user_id or row.get("candidate_id") or "unknown"))
    data = neon_row_as_data(row)
    _put(row_to_item(pk=pk, sk=sk_assessment(pfx, eid), entity_type=table, data=data))


def get_user_by_email_dynamo(email: str) -> dict | None:
    from app.db.dynamo_relational import load_db_dynamo

    db = load_db_dynamo()
    for u in db.get("users") or []:
        if str(u.get("email") or "").lower() == email.lower():
            return {"id": u["id"], "email": u["email"], "role": u.get("role"), "status": u.get("status")}
    return None


def purge_expired_dynamo(*, delete_object=None) -> dict[str, int]:
    counts = {"sessions": 0, "reset_tokens": 0, "audit_rows": 0, "recordings": 0, "artifacts": 0}
    now = datetime.now(timezone.utc).timestamp()
    for item in _scan_entity("hireright_session"):
        exp = item.get("expires_at")
        if exp and datetime.fromisoformat(str(exp).replace("Z", "+00:00")).timestamp() < now:
            tok = item.get("token")
            if tok:
                delete_session_token_dynamo(tok)
                counts["sessions"] += 1
    for item in _scan_entity("password_reset_token"):
        if item.get("used_at"):
            main_table().delete_item(
                Key={"pk": pk_reset_token_hash(item["token_hash"]), "sk": sk_meta()}
            )
            counts["reset_tokens"] += 1
    return counts


def get_interview_session_data_dynamo(session_id: str) -> dict | None:
    for row in _scan_entity("interview_session"):
        if row.get("session_id") == session_id:
            d = row.get("data") if isinstance(row.get("data"), dict) else row
            return d
    from app.db.dynamo_relational import load_db_dynamo

    db = load_db_dynamo()
    return db.get("interviewSessions", {}).get(session_id)