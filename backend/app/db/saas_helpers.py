from __future__ import annotations

import re
import secrets


def slugify_organization(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", str(name or "workspace").lower().strip())
    base = base.strip("-")[:40]
    return base or "workspace"


def unique_org_slug(name: str, organizations: list[dict]) -> str:
    slug = slugify_organization(name)
    taken = {o.get("slug") for o in organizations if o.get("slug")}
    if slug not in taken:
        return slug
    for i in range(2, 100):
        candidate = f"{slug}-{i}"
        if candidate not in taken:
            return candidate
    return f"{slug}-{secrets.token_hex(3)}"


def provision_employer_tenant(db: dict, user: dict, *, plan_id: str = "plan-starter", trial_days: int = 14) -> dict | None:
    if user.get("role") != "employer":
        return None
    members = db.setdefault("organizationMembers", [])
    existing = next((m for m in members if m.get("userId") == user.get("id")), None)
    if existing:
        orgs = db.get("organizations") or []
        return next((o for o in orgs if o.get("id") == existing.get("organizationId")), None)

    from datetime import datetime, timedelta, timezone

    db.setdefault("organizations", [])
    db.setdefault("organizationSubscriptions", [])
    org_id = secrets.token_hex(8)
    org_name = (user.get("companyName") or "").strip() or f"{str(user.get('name') or 'Team').split()[0]}'s Team"
    slug = unique_org_slug(org_name, db["organizations"])
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    trial_ends = (datetime.now(timezone.utc) + timedelta(days=trial_days)).isoformat().replace("+00:00", "Z")
    organization = {
        "id": org_id,
        "name": org_name,
        "slug": slug,
        "billingEmail": user.get("email"),
        "status": "active",
        "settings": {},
        "createdAt": now,
        "updatedAt": now,
    }
    membership = {
        "id": secrets.token_hex(8),
        "organizationId": org_id,
        "userId": user["id"],
        "role": "owner",
        "joinedAt": now,
    }
    subscription = {
        "id": secrets.token_hex(8),
        "organizationId": org_id,
        "planId": plan_id,
        "status": "trialing",
        "trialEndsAt": trial_ends,
        "createdAt": now,
        "updatedAt": now,
    }
    db["organizations"].append(organization)
    members.append(membership)
    db["organizationSubscriptions"].append(subscription)
    account = next((u for u in db.get("users") or [] if u.get("id") == user.get("id")), None)
    if account:
        account["primaryOrganizationId"] = org_id
        account["companyName"] = account.get("companyName") or org_name
    return organization
