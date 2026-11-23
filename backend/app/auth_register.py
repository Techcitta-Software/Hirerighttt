from __future__ import annotations

import secrets
from datetime import datetime, timezone

import psycopg

from app.db.saas_helpers import unique_org_slug
from app.db.store import _pool_conninfo, _require_database_url


class UniqueAccountError(Exception):
    def __init__(self, field: str, message: str) -> None:
        super().__init__(message)
        self.field = field


def register_account(database_url: str, input: dict) -> dict:
    url = _require_database_url(database_url)
    conninfo = _pool_conninfo(url)
    with psycopg.connect(conninfo) as conn:
        try:
            with conn.transaction():
                row = conn.execute(
                    """INSERT INTO users (id, email, name, password_hash, role, company_name, status, phone, created_at)
                       VALUES (%s,%s,%s,%s,%s,%s,'active',%s,%s::timestamptz)
                       RETURNING id, email, name, password_hash, role, company_name, primary_organization_id, status, phone, created_at""",
                    (
                        input["id"],
                        input["email"],
                        input["name"],
                        input["passwordHash"],
                        input["role"],
                        input.get("companyName") if input["role"] == "employer" else None,
                        input["phone"],
                        input["createdAt"],
                    ),
                ).fetchone()
                user = {
                    "id": row[0],
                    "email": row[1],
                    "name": row[2],
                    "passwordHash": row[3],
                    "role": "employer" if row[4] == "employer" else "jobseeker",
                    "companyName": row[5],
                    "primaryOrganizationId": row[6],
                    "status": row[7] or "active",
                    "phone": row[8],
                    "createdAt": row[9].isoformat().replace("+00:00", "Z")
                    if isinstance(row[9], datetime)
                    else input["createdAt"],
                }
                if input["role"] != "employer":
                    return {"user": user}

                orgs = conn.execute("SELECT slug FROM organizations").fetchall()
                org_id = secrets.token_hex(8)
                org_name = (input.get("companyName") or "").strip() or f"{input['name'].split(' ')[0]}'s Team"
                slug = unique_org_slug(org_name, [{"slug": r[0]} for r in orgs])
                now = input["createdAt"]
                conn.execute(
                    """INSERT INTO organizations (id, name, slug, billing_email, status, settings, created_at, updated_at)
                       VALUES (%s,%s,%s,%s,'active','{}'::jsonb,%s::timestamptz,%s::timestamptz)""",
                    (org_id, org_name, slug, input["email"], now, now),
                )
                member_id = secrets.token_hex(8)
                conn.execute(
                    """INSERT INTO organization_members (id, organization_id, user_id, role, joined_at)
                       VALUES (%s,%s,%s,'owner',%s::timestamptz)""",
                    (member_id, org_id, user["id"], now),
                )
                trial_ends = datetime.now(timezone.utc).timestamp() + 14 * 86400
                trial_iso = datetime.fromtimestamp(trial_ends, tz=timezone.utc).isoformat().replace("+00:00", "Z")
                sub_id = secrets.token_hex(8)
                conn.execute(
                    """INSERT INTO organization_subscriptions
                         (id, organization_id, plan_id, status, trial_ends_at, created_at, updated_at)
                       VALUES (%s,%s,'plan-starter','trialing',%s::timestamptz,%s::timestamptz,%s::timestamptz)""",
                    (sub_id, org_id, trial_iso, now, now),
                )
                conn.execute(
                    "UPDATE users SET primary_organization_id = %s, company_name = %s WHERE id = %s",
                    (org_id, org_name, user["id"]),
                )
                user["primaryOrganizationId"] = org_id
                user["companyName"] = org_name
                return {"user": user, "organization": {"id": org_id, "name": org_name, "slug": slug}}
        except UniqueAccountError:
            raise
        except psycopg.errors.UniqueViolation as err:
            detail = str(getattr(err, "diag", err)).lower()
            if "phone" in detail:
                raise UniqueAccountError("phone", "An account with this mobile number already exists.") from err
            raise UniqueAccountError(
                "email",
                "An account with this email already exists.",
            ) from err
