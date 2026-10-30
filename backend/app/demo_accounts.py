from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.auth_passwords import hash_password, verify_password
from app.db.saas_helpers import provision_employer_tenant
from app.db.talent_index import upsert_candidate_talent
from app.node_config import config

DEMO_SEED_USERS = (
    {
        "id": "demo-user-candidate",
        "name": "Arjun Sharma",
        "email": "demo@hireright.com",
        "password": "password123",
        "phone": "+919000000001",
        "role": "jobseeker",
    },
    {
        "id": "demo-user-candidate-2",
        "name": "Priya Nair",
        "email": "candidate@hireright.com",
        "password": "password123",
        "phone": "+919000000004",
        "role": "jobseeker",
    },
    {
        "id": "demo-user-employer",
        "name": "Sarah Jenkins (Recruiter)",
        "email": "employer@hireright.com",
        "password": "password123",
        "phone": "+919000000002",
        "role": "employer",
        "companyName": "TechCitta Solutions",
    },
    {
        "id": "demo-user-admin",
        "name": "Alex Morgan (Admin)",
        "email": "admin@hireright.com",
        "password": "password123",
        "phone": "+919000000003",
        "role": "employer",
        "companyName": "HIRERIGHT Recruiting",
    },
)


def seed_demo_users_if_needed(db: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    if not config.allow_demo_accounts:
        return db, False
    db.setdefault("users", [])
    changed = False
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    for demo in DEMO_SEED_USERS:
        account = next((u for u in db["users"] if u.get("email") == demo["email"]), None)
        if not account:
            account = {
                "id": demo["id"],
                "name": demo["name"],
                "email": demo["email"],
                "phone": demo["phone"],
                "passwordHash": hash_password(demo["password"]),
                "role": demo["role"],
                "companyName": demo.get("companyName"),
                "status": "active",
                "createdAt": now,
            }
            db["users"].append(account)
            changed = True
        else:
            if not verify_password(demo["password"], account.get("passwordHash") or ""):
                account["passwordHash"] = hash_password(demo["password"])
                changed = True
            for key, val in (
                ("status", "active"),
                ("role", demo["role"]),
                ("phone", demo["phone"]),
                ("name", demo["name"]),
            ):
                if account.get(key) != val:
                    account[key] = val
                    changed = True
            if demo.get("companyName") and account.get("companyName") != demo["companyName"]:
                account["companyName"] = demo["companyName"]
                changed = True

    for demo in DEMO_SEED_USERS:
        if demo["role"] != "employer":
            continue
        account = next((u for u in db["users"] if u.get("email") == demo["email"]), None)
        if not account:
            continue
        before = len(db.get("organizations") or [])
        provision_employer_tenant(db, account, plan_id="plan-pro")
        if len(db.get("organizations") or []) > before:
            changed = True
        member = next((m for m in db.get("organizationMembers") or [] if m.get("userId") == account["id"]), None)
        if member and not account.get("primaryOrganizationId"):
            account["primaryOrganizationId"] = member["organizationId"]
            changed = True

    return db, changed


def index_demo_jobseekers_sync(db: dict[str, Any]) -> None:
    import asyncio

    async def _run() -> None:
        for demo in DEMO_SEED_USERS:
            if demo["role"] != "jobseeker":
                continue
            account = next((u for u in db.get("users") or [] if u.get("email") == demo["email"]), None)
            if not account:
                continue
            profile = (db.get("profiles") or {}).get(demo["email"]) or {
                "fullName": demo["name"],
                "currentRole": "Software Engineer",
                "totalExperience": "2 years",
                "skills": ["JavaScript", "React", "Node.js"],
                "profileVisibility": "marketplace",
            }
            db.setdefault("profiles", {})[demo["email"]] = profile
            try:
                await upsert_candidate_talent(
                    config.database_url,
                    account,
                    profile,
                    (db.get("interviews") or {}).get(demo["email"]),
                )
            except Exception:
                pass

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        asyncio.run(_run())
