"""
Load/save the in-memory DbShape to DynamoDB (mirrors app.db.store Postgres helpers).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import boto3

from app.db.dynamo.key_patterns import (
    gsi1_email_user,
    gsi1_slug_org,
    gsi2_org_jobs,
    gsi2_share_job,
    gsi3_candidate_applications,
    gsi3_org_applications,
    gsi4_invite_token,
    neon_row_as_data,
    pk_email,
    pk_org,
    pk_platform,
    pk_session_token,
    pk_user,
    row_to_item,
    sanitize_item,
    sk_application,
    sk_interview_result,
    sk_interview_session,
    sk_job,
    sk_job_application,
    sk_member,
    sk_meta,
    sk_plan,
    sk_profile,
    sk_subscription,
    sk_vault_candidate,
)
from app.db.dynamo.table_specs import MAIN_TABLE, physical_table_name
from app.db.dynamo_config import dynamo_resource_kwargs
from app.db.store import empty_db

_log = logging.getLogger(__name__)


def _table():
    return boto3.resource("dynamodb", **dynamo_resource_kwargs()).Table(physical_table_name(MAIN_TABLE.logical_name))


def _from_dynamo(value: Any) -> Any:
    if isinstance(value, Decimal):
        if value == value.to_integral_value():
            return int(value)
        return float(value)
    if isinstance(value, dict):
        return {k: _from_dynamo(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_from_dynamo(v) for v in value]
    return value


def _iso(value: Any) -> str:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat().replace("+00:00", "Z")
    return str(value) if value is not None else ""


def _map_job_from_data(data: dict[str, Any]) -> dict[str, Any]:
    extras = data.get("extras") if isinstance(data.get("extras"), dict) else {}
    return {
        "id": data["id"],
        "organizationId": data["organization_id"],
        "createdByUserId": data.get("created_by_user_id"),
        "title": data["title"],
        "company": data["company"],
        "companySlug": extras.get("companySlug"),
        "roleTrack": data.get("role_track") or "",
        "experienceLevel": data.get("experience_level") or "",
        "location": data.get("location") or "",
        "jobDescription": data.get("job_description") or "",
        "requiredSkills": _from_dynamo(data.get("required_skills") or []),
        "shareableCode": data["shareable_code"],
        "status": data.get("status"),
        "createdAt": _iso(data.get("created_at")),
        "createdByEmail": extras.get("createdByEmail") or "",
    }


def load_db_dynamo() -> dict[str, Any]:
    db = empty_db()
    table = _table()
    scan_kwargs: dict[str, Any] = {}
    while True:
        resp = table.scan(**scan_kwargs)
        for raw in resp.get("Items", []):
            item = _from_dynamo(raw)
            et = item.get("entity_type") or ""
            data = item.get("data") or {}
            if et == "subscription_plan":
                db["subscriptionPlans"].append(
                    {
                        "id": data["id"],
                        "code": data["code"],
                        "name": data["name"],
                        "description": data.get("description"),
                        "priceCentsMonthly": int(data.get("price_cents_monthly") or 0),
                        "priceCentsYearly": int(data.get("price_cents_yearly") or 0),
                        "currency": data.get("currency") or "USD",
                        "limits": data.get("limits") or {},
                        "features": data.get("features") or {},
                        "isPublic": data.get("is_public", True),
                        "sortOrder": int(data.get("sort_order") or 0),
                    }
                )
            elif et == "organization":
                db["organizations"].append(
                    {
                        "id": data["id"],
                        "name": data["name"],
                        "slug": data["slug"],
                        "logoUrl": data.get("logo_url"),
                        "website": data.get("website"),
                        "billingEmail": data.get("billing_email"),
                        "status": data.get("status") or "active",
                        "settings": data.get("settings") or {},
                        "createdAt": _iso(data.get("created_at")),
                        "updatedAt": _iso(data.get("updated_at")),
                    }
                )
            elif et == "organization_subscription":
                db["organizationSubscriptions"].append(
                    {
                        "id": data["id"],
                        "organizationId": data["organization_id"],
                        "planId": data["plan_id"],
                        "status": data.get("status") or "trialing",
                        "trialEndsAt": _iso(data.get("trial_ends_at")) if data.get("trial_ends_at") else None,
                        "currentPeriodStart": None,
                        "currentPeriodEnd": None,
                        "stripeCustomerId": data.get("stripe_customer_id"),
                        "stripeSubscriptionId": data.get("stripe_subscription_id"),
                        "createdAt": _iso(data.get("created_at")),
                        "updatedAt": _iso(data.get("updated_at")),
                    }
                )
            elif et == "user":
                db["users"].append(
                    {
                        "id": data["id"],
                        "email": data["email"],
                        "name": data["name"],
                        "passwordHash": data["password_hash"],
                        "role": data.get("role"),
                        "companyName": data.get("company_name"),
                        "primaryOrganizationId": data.get("primary_organization_id"),
                        "status": data.get("status") or "active",
                        "phone": data.get("phone"),
                        "createdAt": _iso(data.get("created_at")),
                    }
                )
            elif et == "organization_member":
                db["organizationMembers"].append(
                    {
                        "id": data["id"],
                        "organizationId": data["organization_id"],
                        "userId": data["user_id"],
                        "role": data.get("role") or "recruiter",
                        "invitedByUserId": data.get("invited_by_user_id"),
                        "joinedAt": _iso(data.get("joined_at")),
                    }
                )
            elif et == "profile":
                email = data.get("email") or item.get("pk", "").replace("EMAIL#", "")
                payload = data.get("data") if isinstance(data.get("data"), dict) else data
                if email:
                    db["profiles"][email] = payload
            elif et == "job":
                db["jobs"].append(_map_job_from_data(data))
            elif et == "employer_application":
                db["employerApplications"].append(
                    {
                        "id": data["id"],
                        "organizationId": data["organization_id"],
                        "jobId": data["job_id"],
                        "candidateEmail": data["candidate_email"],
                        "candidateUserId": data.get("candidate_user_id"),
                        "status": data.get("status") or "new",
                        "data": data.get("data") or {},
                        "appliedAt": _iso(data.get("applied_at")),
                    }
                )
            elif et == "job_application":
                email = data.get("email") or ""
                app_data = data.get("data") if isinstance(data.get("data"), dict) else data
                db["applications"].setdefault(email, []).append(app_data)
            elif et == "interview_result":
                email = data.get("email") or ""
                db["interviews"][email] = data.get("data") or data
            elif et == "interview_session":
                sid = data.get("session_id") or ""
                db["interviewSessions"][sid] = data.get("data") or data
            elif et == "confidential_candidate":
                row = dict(data.get("data") or data)
                row["id"] = data.get("id")
                row["organizationId"] = data.get("organization_id")
                db["confidentialVault"].append(row)
        if "LastEvaluatedKey" not in resp:
            break
        scan_kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    db["subscriptionPlans"].sort(key=lambda p: p.get("sortOrder", 0))
    return db


def _batch_put(items: list[dict[str, Any]]) -> None:
    if not items:
        return
    table = _table()
    with table.batch_writer(overwrite_by_pkeys=["pk", "sk"]) as batch:
        for item in items:
            batch.put_item(Item=sanitize_item(item))


def mirror_db_to_dynamo(db: dict[str, Any]) -> None:
    """Write current in-memory DbShape to DynamoDB (idempotent upsert). Used for dual / dynamodb modes."""
    items: list[dict[str, Any]] = []
    for p in db.get("subscriptionPlans") or []:
        data = neon_row_as_data(
            {
                "id": p["id"],
                "code": p["code"],
                "name": p["name"],
                "description": p.get("description"),
                "price_cents_monthly": p.get("priceCentsMonthly", 0),
                "price_cents_yearly": p.get("priceCentsYearly", 0),
                "currency": p.get("currency", "USD"),
                "limits": p.get("limits") or {},
                "features": p.get("features") or {},
                "is_public": p.get("isPublic", True),
                "sort_order": p.get("sortOrder", 0),
            }
        )
        items.append(
            row_to_item(
                pk=pk_platform(),
                sk=sk_plan(p["id"]),
                entity_type="subscription_plan",
                data=data,
            )
        )
    for o in db.get("organizations") or []:
        data = neon_row_as_data(
            {
                "id": o["id"],
                "name": o["name"],
                "slug": o["slug"],
                "logo_url": o.get("logoUrl"),
                "website": o.get("website"),
                "billing_email": o.get("billingEmail"),
                "status": o.get("status") or "active",
                "settings": o.get("settings") or {},
                "created_at": o.get("createdAt"),
                "updated_at": o.get("updatedAt"),
            }
        )
        items.append(
            row_to_item(
                pk=pk_org(o["id"]),
                sk=sk_meta(),
                entity_type="organization",
                data=data,
                gsi=gsi1_slug_org(o["slug"], o["id"]),
            )
        )
    for sub in db.get("organizationSubscriptions") or []:
        data = neon_row_as_data(
            {
                "id": sub["id"],
                "organization_id": sub["organizationId"],
                "plan_id": sub.get("planId"),
                "status": sub.get("status"),
                "created_at": sub.get("createdAt"),
                "updated_at": sub.get("updatedAt"),
            }
        )
        items.append(
            row_to_item(
                pk=pk_org(sub["organizationId"]),
                sk=sk_subscription(),
                entity_type="organization_subscription",
                data=data,
            )
        )
    for u in db.get("users") or []:
        data = neon_row_as_data(
            {
                "id": u["id"],
                "email": u["email"],
                "name": u["name"],
                "password_hash": u["passwordHash"],
                "role": u.get("role"),
                "company_name": u.get("companyName"),
                "primary_organization_id": u.get("primaryOrganizationId"),
                "status": u.get("status"),
                "phone": u.get("phone"),
                "created_at": u.get("createdAt"),
            }
        )
        items.append(
            row_to_item(
                pk=pk_user(u["id"]),
                sk=sk_meta(),
                entity_type="user",
                data=data,
                gsi=gsi1_email_user(u["email"], u["id"]),
            )
        )
    for m in db.get("organizationMembers") or []:
        data = neon_row_as_data(
            {
                "id": m["id"],
                "organization_id": m["organizationId"],
                "user_id": m["userId"],
                "role": m.get("role"),
                "invited_by_user_id": m.get("invitedByUserId"),
                "joined_at": m.get("joinedAt"),
            }
        )
        items.append(
            row_to_item(
                pk=pk_org(m["organizationId"]),
                sk=sk_member(m["userId"]),
                entity_type="organization_member",
                data=data,
            )
        )
    for email, profile in (db.get("profiles") or {}).items():
        data = neon_row_as_data({"email": email, "data": profile})
        uid = next((u["id"] for u in db.get("users") or [] if u.get("email") == email), None)
        pk = pk_user(uid) if uid else pk_email(email)
        items.append(
            row_to_item(
                pk=pk,
                sk=sk_profile(),
                entity_type="profile",
                data=data,
                gsi=gsi1_email_user(email, uid or email),
            )
        )
    for job in db.get("jobs") or []:
        extras = {"createdByEmail": job.get("createdByEmail") or "", "companySlug": job.get("companySlug")}
        data = neon_row_as_data(
            {
                "id": job["id"],
                "organization_id": job["organizationId"],
                "created_by_user_id": job.get("createdByUserId"),
                "title": job["title"],
                "company": job["company"],
                "role_track": job.get("roleTrack"),
                "experience_level": job.get("experienceLevel"),
                "location": job.get("location"),
                "job_description": job.get("jobDescription"),
                "required_skills": job.get("requiredSkills") or [],
                "shareable_code": job["shareableCode"],
                "status": job.get("status"),
                "extras": extras,
                "created_at": job.get("createdAt"),
                "updated_at": job.get("createdAt"),
            }
        )
        gsi = {
            **gsi2_share_job(job.get("shareableCode") or "", job["id"]),
            **gsi2_org_jobs(job["organizationId"], job["id"], job.get("status") or ""),
        }
        items.append(
            row_to_item(
                pk=pk_org(job["organizationId"]),
                sk=sk_job(job["id"]),
                entity_type="job",
                data=data,
                gsi=gsi,
            )
        )
    for app in db.get("employerApplications") or []:
        data = neon_row_as_data(
            {
                "id": app["id"],
                "organization_id": app["organizationId"],
                "job_id": app["jobId"],
                "candidate_email": app["candidateEmail"],
                "candidate_user_id": app.get("candidateUserId"),
                "status": app.get("status"),
                "data": app.get("data") or {},
                "applied_at": app.get("appliedAt"),
            }
        )
        items.append(
            row_to_item(
                pk=pk_org(app["organizationId"]),
                sk=sk_application(app["id"]),
                entity_type="employer_application",
                data=data,
                gsi=gsi3_org_applications(app["organizationId"], app["id"], str(app.get("appliedAt") or "")),
            )
        )
    for email, apps in (db.get("applications") or {}).items():
        for app in apps or []:
            aid = str(app.get("id") or "")
            if not aid:
                continue
            data = neon_row_as_data(
                {"id": aid, "email": email, "data": app, "created_at": app.get("appliedAt")}
            )
            items.append(
                row_to_item(
                    pk=pk_email(email),
                    sk=sk_job_application(aid),
                    entity_type="job_application",
                    data=data,
                    gsi=gsi3_candidate_applications(email, aid, str(app.get("appliedAt") or "")),
                )
            )
    for email, payload in (db.get("interviews") or {}).items():
        data = neon_row_as_data({"email": email, "data": payload})
        items.append(
            row_to_item(
                pk=pk_email(email),
                sk=sk_interview_result(),
                entity_type="interview_result",
                data=data,
            )
        )
    for sid, payload in (db.get("interviewSessions") or {}).items():
        email = str((payload or {}).get("email") or "")
        data = neon_row_as_data({"session_id": sid, "email": email, "data": payload})
        items.append(
            row_to_item(
                pk=pk_email(email or "unknown@local"),
                sk=sk_interview_session(sid),
                entity_type="interview_session",
                data=data,
            )
        )
    for v in db.get("confidentialVault") or []:
        vid = v.get("id") or ""
        oid = v.get("organizationId") or "org-platform"
        data = neon_row_as_data({"id": vid, "organization_id": oid, "data": v})
        items.append(
            row_to_item(
                pk=pk_org(oid),
                sk=sk_vault_candidate(vid),
                entity_type="confidential_candidate",
                data=data,
            )
        )
    chunk = 200
    for i in range(0, len(items), chunk):
        _batch_put(items[i : i + chunk])

    # Keep candidate_talent_profiles in sync (Neon upserted these on profile/interview updates).
    from app.db.dynamo_config import database_provider

    if database_provider() == "dynamodb":
        from app.db import dynamo_repos as dr
        from app.db.talent_index import build_talent_record

        interviews = db.get("interviews") or {}
        profiles = db.get("profiles") or {}
        for u in db.get("users") or []:
            if (u.get("role") or "") == "employer":
                continue
            em = u.get("email")
            if not em:
                continue
            prof = profiles.get(em) or {}
            if not prof and em not in interviews:
                continue
            dr.upsert_talent_profile_dynamo(
                build_talent_record(u, prof, interviews.get(em)),
            )


def upsert_job_dynamo(job: dict[str, Any]) -> None:
    extras = {"createdByEmail": job.get("createdByEmail") or "", "companySlug": job.get("companySlug")}
    data = neon_row_as_data(
        {
            "id": job["id"],
            "organization_id": job["organizationId"],
            "created_by_user_id": job.get("createdByUserId"),
            "title": job["title"],
            "company": job["company"],
            "role_track": job.get("roleTrack"),
            "experience_level": job.get("experienceLevel"),
            "location": job.get("location"),
            "job_description": job.get("jobDescription"),
            "required_skills": job.get("requiredSkills") or [],
            "shareable_code": job["shareableCode"],
            "status": job.get("status"),
            "extras": extras,
            "created_at": job.get("createdAt"),
            "updated_at": job.get("createdAt"),
        }
    )
    gsi = {
        **gsi2_share_job(job.get("shareableCode") or "", job["id"]),
        **gsi2_org_jobs(job["organizationId"], job["id"], job.get("status") or ""),
    }
    item = row_to_item(
        pk=pk_org(job["organizationId"]),
        sk=sk_job(job["id"]),
        entity_type="job",
        data=data,
        gsi=gsi,
    )
    _table().put_item(Item=sanitize_item(item))


def ping_dynamo() -> dict[str, Any]:
    try:
        _table().table_status
        return {"ok": True, "storage": "dynamodb"}
    except Exception as exc:
        return {"ok": False, "storage": "dynamodb", "reason": str(exc)}