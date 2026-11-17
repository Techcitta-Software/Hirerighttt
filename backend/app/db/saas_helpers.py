from __future__ import annotations

import re
import secrets


def slugify_organization(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", str(name or "workspace").lower().strip())
    base = base.strip("-")[:40]
    return base or "workspace"


def unique_org_slug(name: str, organizations: list[dict] | None = None, *, db: dict | None = None) -> str:
    slug = slugify_organization(name)
    if db is not None:
        from app.db.finders import organization_slugs_like

        taken = organization_slugs_like(db, slug)
    else:
        taken = {o.get("slug") for o in organizations or [] if o.get("slug")}
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
    from app.db.finders import find_organization, find_user, memberships_for_user, subscription_for_org

    members = db.setdefault("organizationMembers", [])
    existing = next(iter(memberships_for_user(db, user.get("id"))), None)
    if existing:
        return find_organization(db, existing.get("organizationId"))

    from datetime import datetime, timedelta, timezone

    # The user already belongs to an organization (recorded on the account): re-attach to it instead of
    # creating a new, empty organization (which orphaned all of that organization's jobs).
    primary_id = user.get("primaryOrganizationId")
    primary = find_organization(db, primary_id) if primary_id else None
    if primary:
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        members.append(
            {
                "id": secrets.token_hex(8),
                "organizationId": primary["id"],
                "userId": user["id"],
                "role": "owner",
                "joinedAt": now,
            }
        )
        subs = db.setdefault("organizationSubscriptions", [])
        if not subscription_for_org(db, primary["id"]):
            subs.append(
                {
                    "id": secrets.token_hex(8),
                    "organizationId": primary["id"],
                    "planId": plan_id,
                    "status": "trialing",
                    "trialEndsAt": (datetime.now(timezone.utc) + timedelta(days=trial_days)).isoformat().replace("+00:00", "Z"),
                    "createdAt": now,
                    "updatedAt": now,
                }
            )
        return primary

    db.setdefault("organizations", [])
    db.setdefault("organizationSubscriptions", [])
    org_id = secrets.token_hex(8)
    org_name = (user.get("companyName") or "").strip() or f"{str(user.get('name') or 'Team').split()[0]}'s Team"
    slug = unique_org_slug(org_name, db=db)
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
    account = find_user(db, user_id=user.get("id"))
    if account:
        account["primaryOrganizationId"] = org_id
        account["companyName"] = account.get("companyName") or org_name
    return organization
