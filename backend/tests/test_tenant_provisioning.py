"""An employer must keep the same organization across restarts (jobs belong to the organization)."""

from __future__ import annotations

from app.db.saas_helpers import provision_employer_tenant


def _db_with_user(primary_org: str | None) -> dict:
    orgs = [{"id": "org-existing", "name": "TechCitta Solutions", "slug": "techcitta-solutions"}] if primary_org else []
    return {
        "users": [
            {"id": "u1", "email": "vendor@example.com", "role": "employer", "name": "Vendor", "primaryOrganizationId": primary_org}
        ],
        "organizations": orgs,
        "organizationMembers": [],
        "organizationSubscriptions": [],
    }


def test_reattaches_to_existing_primary_organization() -> None:
    db = _db_with_user("org-existing")
    org = provision_employer_tenant(db, db["users"][0])
    assert org and org["id"] == "org-existing"
    assert len(db["organizations"]) == 1
    assert db["organizationMembers"][0]["organizationId"] == "org-existing"
    assert db["organizationMembers"][0]["role"] == "owner"


def test_second_call_is_stable() -> None:
    db = _db_with_user("org-existing")
    first = provision_employer_tenant(db, db["users"][0])
    second = provision_employer_tenant(db, db["users"][0])
    assert first["id"] == second["id"] == "org-existing"
    assert len(db["organizationMembers"]) == 1


def test_creates_an_organization_only_when_none_exists() -> None:
    db = _db_with_user(None)
    org = provision_employer_tenant(db, db["users"][0])
    assert org and org["id"] != "org-existing"
    assert db["users"][0]["primaryOrganizationId"] == org["id"]
    assert len(db["organizations"]) == 1 and len(db["organizationSubscriptions"]) == 1


def test_jobseekers_get_no_organization() -> None:
    db = {"users": [{"id": "c1", "role": "jobseeker"}], "organizations": [], "organizationMembers": []}
    assert provision_employer_tenant(db, db["users"][0]) is None


def test_reattach_adds_missing_subscription_once() -> None:
    db = _db_with_user("org-existing")
    provision_employer_tenant(db, db["users"][0], plan_id="plan-pro")
    assert [s["organizationId"] for s in db["organizationSubscriptions"]] == ["org-existing"]
    assert db["organizationSubscriptions"][0]["planId"] == "plan-pro"
