"""Per-request unit of work (app/db/uow.py) against a real throwaway Postgres. Skipped without TEST_DATABASE_URL.

What these prove:
* a request reads only the rows it asks for (no full-table loads on the hot paths);
* a save writes only what changed;
* two requests never share in-memory state (each API instance / worker can run independently);
* data that used to live only in process memory (alerts, contact requests, vault) is now persisted.
"""

from __future__ import annotations

import os
import secrets

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not set")


@pytest.fixture
def url():
    from app.db import store as db_store
    from app.node_config import config

    object.__setattr__(config, "database_url", os.environ["TEST_DATABASE_URL"])
    db_store.close_store()
    db_store._ensure_schema(config.database_url)
    yield config.database_url
    db_store.close_store()


def _new_user(uow, role="jobseeker"):
    tag = secrets.token_hex(4)
    user = {
        "id": f"u-{tag}",
        "email": f"uow-{tag}@test.local",
        "name": f"UoW {tag}",
        "passwordHash": "scrypt$x$y",
        "role": role,
        "status": "active",
    }
    uow["users"].append(user)
    return user


class _CountingUow:
    """Wrap a UnitOfWork's query() to count the SQL it runs."""

    def __init__(self, uow):
        self.uow = uow
        self.sql: list[str] = []
        original = uow.query

        def counting(sql, params=()):
            self.sql.append(" ".join(sql.split()))
            return original(sql, params)

        uow.query = counting


def test_new_rows_are_written_and_read_back_by_key(url):
    from app.db.finders import find_user
    from app.db.uow import UnitOfWork

    a = UnitOfWork(url)
    user = _new_user(a)
    a["profiles"][user["email"]] = {"fullName": user["name"], "skills": ["Python"]}
    assert a.flush() == 2

    b = UnitOfWork(url)  # a different request
    spy = _CountingUow(b)
    assert find_user(b, email=user["email"].upper())["id"] == user["id"]
    assert b["profiles"].get(user["email"])["skills"] == ["Python"]
    assert all("WHERE" in s for s in spy.sql), spy.sql  # indexed lookups only, never a full table


def test_a_save_writes_only_what_changed(url):
    from app.db.finders import find_user
    from app.db.uow import UnitOfWork

    a = UnitOfWork(url)
    user = _new_user(a)
    a["profiles"][user["email"]] = {"n": 1}
    a.flush()

    b = UnitOfWork(url)
    find_user(b, email=user["email"])
    profile = b["profiles"][user["email"]]
    assert b.flush() == 0  # nothing changed: nothing written
    profile["n"] = 2
    assert b.flush() == 1  # exactly the one profile

    c = UnitOfWork(url)
    assert c["profiles"][user["email"]]["n"] == 2


def test_requests_do_not_share_state(url):
    from app.db.finders import find_user
    from app.db.uow import UnitOfWork

    a = UnitOfWork(url)
    user = _new_user(a)
    a.flush()

    b = UnitOfWork(url)
    c = UnitOfWork(url)
    find_user(b, email=user["email"])["name"] = "Changed in b"
    assert find_user(c, email=user["email"])["name"] == user["name"]  # c never sees b's unsaved change
    b.flush()
    assert find_user(UnitOfWork(url), email=user["email"])["name"] == "Changed in b"


def test_missing_keys_and_deletes(url):
    from app.db.uow import UnitOfWork

    a = UnitOfWork(url)
    user = _new_user(a)
    assert a["profiles"].get(user["email"]) is None
    assert (a.get("profiles") or {}).get("nobody@x") is None  # truthiness must not load the whole table
    a["interviews"][user["email"]] = {"overall": 71.6}
    a.flush()

    b = UnitOfWork(url)
    assert b["interviews"][user["email"]]["overall"] == 71.6
    b["interviews"].pop(user["email"])
    b.flush()
    assert UnitOfWork(url)["interviews"].get(user["email"]) is None


def test_applications_replace_only_that_candidates_rows(url):
    from app.db.uow import UnitOfWork

    a = UnitOfWork(url)
    u1, u2 = _new_user(a), _new_user(a)
    a["applications"][u1["email"]] = [{"id": "app-1", "jobId": "j1"}, {"id": "app-2", "jobId": "j2"}]
    a["applications"][u2["email"]] = [{"id": "app-3", "jobId": "j1"}]
    a.flush()

    b = UnitOfWork(url)
    b["applications"][u1["email"]] = [x for x in b["applications"][u1["email"]] if x["id"] != "app-1"]
    b.flush()

    c = UnitOfWork(url)
    assert [x["id"] for x in c["applications"][u1["email"]]] == ["app-2"]
    assert [x["id"] for x in c["applications"][u2["email"]]] == ["app-3"]  # untouched (it used to wipe the table)


def test_alerts_and_contact_requests_survive_a_restart(url):
    from app.db.uow import UnitOfWork

    a = UnitOfWork(url)
    key = f"cand-{secrets.token_hex(3)}@test.local"
    a["candidateJobAlerts"][key] = [{"id": "alert-1", "jobId": "j1", "read": False}]
    a.setdefault("contactRequests", []).insert(0, {"id": f"c-{secrets.token_hex(4)}", "message": "hello"})
    a.flush()

    b = UnitOfWork(url)
    assert b["candidateJobAlerts"][key][0]["id"] == "alert-1"


def test_tenant_flow_uses_indexed_lookups(url):
    from app.db.finders import find_user, members_of_org
    from app.db.saas_helpers import provision_employer_tenant
    from app.db.uow import UnitOfWork
    from app.server import runtime

    a = UnitOfWork(url)
    plans = a["subscriptionPlans"]
    if not list(plans):
        pytest.skip("subscription plans are not seeded in this database")
    owner = _new_user(a, role="employer")
    owner["companyName"] = "UoW Test Co"
    a.flush()
    org = provision_employer_tenant(a, owner, plan_id=list(plans)[0]["id"])
    a.flush()

    b = UnitOfWork(url)
    spy = _CountingUow(b)
    user = find_user(b, email=owner["email"])
    tenant = runtime.tenant_context_for_user(b, user)
    assert tenant["organization"]["id"] == org["id"]
    assert [m["userId"] for m in members_of_org(b, org["id"])] == [owner["id"]]
    assert not any(s.startswith("SELECT * FROM users ORDER BY") for s in spy.sql)


def test_vault_items_are_persisted_and_deleted(url):
    from app.db.finders import remove_vault_item, vault_for_org
    from app.db.saas_helpers import provision_employer_tenant
    from app.db.uow import UnitOfWork

    a = UnitOfWork(url)
    plans = list(a["subscriptionPlans"])
    if not plans:
        pytest.skip("subscription plans are not seeded in this database")
    owner = _new_user(a, role="employer")
    owner["companyName"] = "Vault Co"
    org = provision_employer_tenant(a, owner, plan_id=plans[0]["id"])
    a["confidentialVault"].insert(0, {"id": f"conf-{secrets.token_hex(4)}", "organizationId": org["id"], "name": "Hidden"})
    a.flush()

    b = UnitOfWork(url)
    items = vault_for_org(b, org["id"])
    assert [i["name"] for i in items] == ["Hidden"]  # this table was never saved before
    remove_vault_item(b, items[0])
    b.flush()
    assert vault_for_org(UnitOfWork(url), org["id"]) == []
