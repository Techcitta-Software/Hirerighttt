"""Per-request unit of work over Postgres: load only the rows a request touches, write back only what changed.

Why this exists
---------------
The API used to keep the WHOLE database in one process-wide dict (`runtime._db_cache`) and wrote the whole thing back
on every save. That cannot scale: memory grows with every user (≈1 GB at 100k users), a save rewrote every row
(one profile update at 100k users took > 5 minutes), and two API instances would overwrite each other.

`UnitOfWork` keeps the same dict-like shape the route code already uses, so existing code such as

    db = runtime.load_db()
    profile = db["profiles"].get(email)       # one indexed SELECT, on first access only
    profile["x"] = 1
    await runtime.save_db(db)                  # one UPSERT for that one profile

keeps working, but every collection is now backed by indexed queries:

* keyed collections (profiles, interviews, applications, interviewSessions, candidateJobAlerts,
  employerApplicationAlerts) load one key at a time;
* list collections (users, organizations, jobs, ...) are filled by the `find_*` helpers in `app.db.finders`, which
  run indexed queries. Iterating a whole list collection still works (it loads the table) but logs a warning, so a
  missed hot path shows up in the logs instead of silently getting slow.

Every object handed out is remembered with a JSON snapshot; `flush()` writes exactly the objects whose content
changed, plus explicit deletions, in a single transaction.
"""

from __future__ import annotations

import contextvars
import json
import logging
import threading
import traceback
from collections.abc import MutableMapping, MutableSequence
from typing import Any, Callable, Iterable

_log = logging.getLogger("hireright.uow")


def _snap(value: Any) -> str:
    return json.dumps(value, sort_keys=True, default=str)


def _iso(value: Any) -> str | None:
    from app.db.store import _iso as store_iso

    return store_iso(value) if value is not None else None


# --------------------------------------------------------------------------------------------------------------
# Row <-> object mapping for every collection
# --------------------------------------------------------------------------------------------------------------

def _user_obj(r: dict) -> dict:
    return {
        "id": r["id"],
        "email": r["email"],
        "name": r["name"],
        "passwordHash": r["password_hash"],
        "role": r.get("role"),
        "companyName": r.get("company_name"),
        "primaryOrganizationId": r.get("primary_organization_id"),
        "status": r.get("status") or "active",
        "phone": r.get("phone"),
        "createdAt": _iso(r.get("created_at")),
    }


def _org_obj(r: dict) -> dict:
    return {
        "id": r["id"],
        "name": r["name"],
        "slug": r["slug"],
        "logoUrl": r.get("logo_url"),
        "website": r.get("website"),
        "billingEmail": r.get("billing_email"),
        "status": r["status"],
        "settings": r.get("settings") or {},
        "createdAt": _iso(r.get("created_at")),
        "updatedAt": _iso(r.get("updated_at")),
    }


def _sub_obj(r: dict) -> dict:
    return {
        "id": r["id"],
        "organizationId": r["organization_id"],
        "planId": r["plan_id"],
        "status": r["status"],
        "trialEndsAt": _iso(r.get("trial_ends_at")),
        "currentPeriodStart": _iso(r.get("current_period_start")),
        "currentPeriodEnd": _iso(r.get("current_period_end")),
        "stripeCustomerId": r.get("stripe_customer_id"),
        "stripeSubscriptionId": r.get("stripe_subscription_id"),
        "createdAt": _iso(r.get("created_at")),
        "updatedAt": _iso(r.get("updated_at")),
    }


def _plan_obj(r: dict) -> dict:
    return {
        "id": r["id"],
        "code": r["code"],
        "name": r["name"],
        "description": r.get("description"),
        "priceCentsMonthly": r["price_cents_monthly"],
        "priceCentsYearly": r["price_cents_yearly"],
        "currency": r["currency"],
        "limits": r.get("limits") or {},
        "features": r.get("features") or {},
        "isPublic": r["is_public"],
        "sortOrder": r["sort_order"],
    }


def _member_obj(r: dict) -> dict:
    return {
        "id": r["id"],
        "organizationId": r["organization_id"],
        "userId": r["user_id"],
        "role": r["role"],
        "invitedByUserId": r.get("invited_by_user_id"),
        "joinedAt": _iso(r.get("joined_at")),
    }


def _job_obj(r: dict) -> dict:
    from app.db.store import _map_job_row

    return _map_job_row(r)


def _employer_app_obj(r: dict) -> dict:
    return {
        "id": r["id"],
        "organizationId": r["organization_id"],
        "jobId": r["job_id"],
        "candidateEmail": r["candidate_email"],
        "candidateUserId": r.get("candidate_user_id"),
        "status": r["status"],
        "data": r.get("data") or {},
        "appliedAt": _iso(r.get("applied_at")),
    }


def _vault_obj(r: dict) -> dict:
    item = dict(r["data"]) if isinstance(r.get("data"), dict) else {}
    item["id"] = r["id"]
    item["organizationId"] = r["organization_id"]
    return item


def _kv_obj(r: dict) -> dict:
    item = dict(r["data"]) if isinstance(r.get("data"), dict) else {}
    item.setdefault("id", r["key"])
    return item


# --------------------------------------------------------------------------------------------------------------
# Writers. Each takes (conn, objects) and writes them in one statement.
# --------------------------------------------------------------------------------------------------------------

def _rs(rows: list[dict]) -> list[Any]:
    return [json.dumps(rows, default=str)]


def _write_users(conn, objs: list[dict]) -> None:
    rows = [
        {
            "id": u["id"],
            "email": str(u["email"]).lower(),
            "name": u.get("name") or "",
            "password_hash": u.get("passwordHash") or "",
            "role": u.get("role") or "jobseeker",
            "company_name": u.get("companyName"),
            "primary_organization_id": u.get("primaryOrganizationId"),
            "status": u.get("status") or "active",
            "phone": u.get("phone"),
            "created_at": u.get("createdAt"),
        }
        for u in objs
    ]
    conn.execute(
        """INSERT INTO users (id, email, name, password_hash, role, company_name, primary_organization_id, status, phone, created_at)
           SELECT id, email, name, password_hash, role, company_name, primary_organization_id, status, phone,
             COALESCE(created_at::timestamptz, NOW())
           FROM jsonb_to_recordset(%s::jsonb) AS x(id text, email text, name text, password_hash text, role text,
             company_name text, primary_organization_id text, status text, phone text, created_at timestamptz)
           ON CONFLICT (email) DO UPDATE SET
             name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role,
             company_name = EXCLUDED.company_name, primary_organization_id = EXCLUDED.primary_organization_id,
             status = EXCLUDED.status, phone = COALESCE(EXCLUDED.phone, users.phone)
           WHERE users.id = EXCLUDED.id""",
        _rs(rows),
    )


def _write_orgs(conn, objs: list[dict]) -> None:
    rows = [
        {
            "id": o["id"],
            "name": o.get("name") or "",
            "slug": o.get("slug") or o["id"],
            "logo_url": o.get("logoUrl"),
            "website": o.get("website"),
            "billing_email": o.get("billingEmail"),
            "status": o.get("status") or "active",
            "settings": o.get("settings") or {},
            "created_at": o.get("createdAt"),
            "updated_at": o.get("updatedAt"),
        }
        for o in objs
    ]
    conn.execute(
        """INSERT INTO organizations (id, name, slug, logo_url, website, billing_email, status, settings, created_at, updated_at)
           SELECT id, name, slug, logo_url, website, billing_email, status, settings,
             COALESCE(created_at::timestamptz, NOW()), COALESCE(updated_at::timestamptz, NOW())
           FROM jsonb_to_recordset(%s::jsonb) AS x(id text, name text, slug text, logo_url text, website text,
             billing_email text, status text, settings jsonb, created_at timestamptz, updated_at timestamptz)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name, slug = EXCLUDED.slug, logo_url = EXCLUDED.logo_url,
             website = EXCLUDED.website, billing_email = EXCLUDED.billing_email,
             status = EXCLUDED.status, settings = EXCLUDED.settings, updated_at = NOW()""",
        _rs(rows),
    )


def _write_members(conn, objs: list[dict]) -> None:
    rows = [
        {
            "id": m["id"],
            "organization_id": m["organizationId"],
            "user_id": m["userId"],
            "role": m.get("role") or "recruiter",
            "invited_by_user_id": m.get("invitedByUserId"),
            "joined_at": m.get("joinedAt"),
        }
        for m in objs
        if m.get("id") and m.get("organizationId") and m.get("userId")
    ]
    if not rows:
        return
    conn.execute(
        """INSERT INTO organization_members (id, organization_id, user_id, role, invited_by_user_id, joined_at)
           SELECT x.id, x.organization_id, x.user_id, x.role, x.invited_by_user_id, COALESCE(x.joined_at::timestamptz, NOW())
           FROM jsonb_to_recordset(%s::jsonb) AS x(id text, organization_id text, user_id text, role text,
             invited_by_user_id text, joined_at timestamptz)
           WHERE EXISTS (SELECT 1 FROM organizations o WHERE o.id = x.organization_id)
             AND EXISTS (SELECT 1 FROM users u WHERE u.id = x.user_id)
           ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role""",
        _rs(rows),
    )


def _write_subs(conn, objs: list[dict]) -> None:
    rows = [
        {
            "id": s["id"],
            "organization_id": s["organizationId"],
            "plan_id": s.get("planId") or "plan-starter",
            "status": s.get("status") or "trialing",
            "trial_ends_at": s.get("trialEndsAt"),
            "created_at": s.get("createdAt"),
            "updated_at": s.get("updatedAt"),
        }
        for s in objs
        if s.get("id") and s.get("organizationId")
    ]
    if not rows:
        return
    conn.execute(
        # Billing fields are owned by the billing flow, so an existing subscription is never overwritten from here.
        """INSERT INTO organization_subscriptions (id, organization_id, plan_id, status, trial_ends_at, created_at, updated_at)
           SELECT x.id, x.organization_id, x.plan_id, x.status, x.trial_ends_at::timestamptz,
             COALESCE(x.created_at::timestamptz, NOW()), COALESCE(x.updated_at::timestamptz, NOW())
           FROM jsonb_to_recordset(%s::jsonb) AS x(id text, organization_id text, plan_id text, status text,
             trial_ends_at text, created_at text, updated_at text)
           WHERE EXISTS (SELECT 1 FROM organizations o WHERE o.id = x.organization_id)
             AND EXISTS (SELECT 1 FROM subscription_plans p WHERE p.id = x.plan_id)
           ON CONFLICT (organization_id) DO NOTHING""",
        _rs(rows),
    )


def _write_jobs(conn, objs: list[dict]) -> None:
    from datetime import datetime, timezone

    for job in objs:
        if not job.get("id") or not job.get("shareableCode") or not job.get("organizationId"):
            continue
        extras = {"createdByEmail": job.get("createdByEmail") or "", "companySlug": job.get("companySlug")}
        conn.execute(
            """INSERT INTO jobs (
                 id, organization_id, created_by_user_id, title, company, role_track, experience_level,
                 location, job_description, required_skills, shareable_code, status, extras, created_at, updated_at
               ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s::jsonb,%s::timestamptz,NOW())
               ON CONFLICT (id) DO UPDATE SET
                 title = EXCLUDED.title, company = EXCLUDED.company, job_description = EXCLUDED.job_description,
                 required_skills = EXCLUDED.required_skills, status = EXCLUDED.status, updated_at = NOW(),
                 role_track = EXCLUDED.role_track, experience_level = EXCLUDED.experience_level,
                 location = EXCLUDED.location, shareable_code = EXCLUDED.shareable_code, extras = EXCLUDED.extras""",
            (
                job["id"],
                job["organizationId"],
                job.get("createdByUserId"),
                job.get("title") or "",
                job.get("company") or "",
                job.get("roleTrack"),
                job.get("experienceLevel"),
                job.get("location"),
                job.get("jobDescription"),
                json.dumps(job.get("requiredSkills") or []),
                job["shareableCode"],
                job.get("status") or "published",
                json.dumps(extras),
                job.get("createdAt") or datetime.now(timezone.utc).isoformat(),
            ),
        )


def _write_employer_apps(conn, objs: list[dict]) -> None:
    rows = [
        {
            "id": a["id"],
            "organization_id": a["organizationId"],
            "job_id": a["jobId"],
            "candidate_email": str(a.get("candidateEmail") or "").lower(),
            "candidate_user_id": a.get("candidateUserId"),
            "status": a.get("status") or "new",
            "data": a.get("data") or {},
            "applied_at": a.get("appliedAt"),
        }
        for a in objs
        if a.get("id") and a.get("organizationId") and a.get("jobId")
    ]
    if not rows:
        return
    conn.execute(
        """INSERT INTO employer_applications (id, organization_id, job_id, candidate_user_id, candidate_email, status, data, applied_at)
           SELECT x.id, x.organization_id, x.job_id, x.candidate_user_id, x.candidate_email, x.status, x.data,
             COALESCE(x.applied_at::timestamptz, NOW())
           FROM jsonb_to_recordset(%s::jsonb) AS x(id text, organization_id text, job_id text, candidate_user_id text,
             candidate_email text, status text, data jsonb, applied_at timestamptz)
           WHERE EXISTS (SELECT 1 FROM jobs j WHERE j.id = x.job_id)
           ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, data = EXCLUDED.data,
             candidate_user_id = COALESCE(EXCLUDED.candidate_user_id, employer_applications.candidate_user_id)""",
        _rs(rows),
    )


def _write_vault(conn, objs: list[dict]) -> None:
    rows = []
    for c in objs:
        if not c.get("id") or not c.get("organizationId"):
            continue
        data = {k: v for k, v in c.items() if k not in ("id", "organizationId")}
        rows.append({"id": c["id"], "organization_id": c["organizationId"], "data": data, "sort_order": int(c.get("sortOrder") or 0)})
    if not rows:
        return
    conn.execute(
        """INSERT INTO confidential_candidates (id, organization_id, data, sort_order)
           SELECT x.id, x.organization_id, x.data, x.sort_order
           FROM jsonb_to_recordset(%s::jsonb) AS x(id text, organization_id text, data jsonb, sort_order int)
           WHERE EXISTS (SELECT 1 FROM organizations o WHERE o.id = x.organization_id)
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, sort_order = EXCLUDED.sort_order""",
        _rs(rows),
    )


def _kv_writer(namespace: str) -> Callable:
    def write(conn, objs: list[dict]) -> None:
        rows = [{"key": str(o.get("id")), "data": o} for o in objs if o.get("id")]
        if rows:
            conn.execute(
                """INSERT INTO app_kv (namespace, key, data, updated_at)
                   SELECT %s, x.key, x.data, NOW() FROM jsonb_to_recordset(%s::jsonb) AS x(key text, data jsonb)
                   ON CONFLICT (namespace, key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()""",
                [namespace, *_rs(rows)],
            )

    return write


def _kv_deleter(namespace: str) -> Callable:
    def delete(conn, keys: list[str]) -> None:
        conn.execute("DELETE FROM app_kv WHERE namespace = %s AND key = ANY(%s)", (namespace, keys))

    return delete


def _deleter(sql: str) -> Callable:
    def delete(conn, keys: list[Any]) -> None:
        conn.execute(sql, (keys,))

    return delete


class ListSpec:
    def __init__(
        self,
        name: str,
        key: Callable[[dict], Any],
        to_obj: Callable[[dict], dict],
        select_all: str,
        writer: Callable | None,
        deleter: Callable | None,
        delete_key: Callable[[dict], Any] | None = None,
        select_params: tuple = (),
    ) -> None:
        self.name = name
        self.key = key
        self.to_obj = to_obj
        self.select_all = select_all
        self.writer = writer
        self.deleter = deleter
        self.delete_key = delete_key or key
        self.select_params = select_params


LIST_SPECS: dict[str, ListSpec] = {
    "users": ListSpec(
        "users", lambda u: str(u.get("email") or "").lower(), _user_obj,
        "SELECT * FROM users ORDER BY created_at ASC", _write_users,
        _deleter("DELETE FROM users WHERE id = ANY(%s)"), delete_key=lambda u: u.get("id"),
    ),
    "organizations": ListSpec(
        "organizations", lambda o: o.get("id"), _org_obj,
        "SELECT * FROM organizations ORDER BY created_at ASC", _write_orgs,
        _deleter("DELETE FROM organizations WHERE id = ANY(%s)"),
    ),
    "organizationMembers": ListSpec(
        "organizationMembers", lambda m: f"{m.get('organizationId')}\0{m.get('userId')}", _member_obj,
        "SELECT * FROM organization_members", _write_members,
        _deleter("DELETE FROM organization_members WHERE id = ANY(%s)"), delete_key=lambda m: m.get("id"),
    ),
    "organizationSubscriptions": ListSpec(
        "organizationSubscriptions", lambda s: s.get("organizationId"), _sub_obj,
        "SELECT * FROM organization_subscriptions", _write_subs, None,
    ),
    "subscriptionPlans": ListSpec(
        "subscriptionPlans", lambda p: p.get("id"), _plan_obj,
        "SELECT * FROM subscription_plans ORDER BY sort_order ASC", None, None,
    ),
    "jobs": ListSpec(
        "jobs", lambda j: j.get("id"), _job_obj,
        "SELECT * FROM jobs ORDER BY created_at DESC", _write_jobs,
        _deleter("DELETE FROM jobs WHERE id = ANY(%s)"),
    ),
    "employerApplications": ListSpec(
        "employerApplications", lambda a: a.get("id"), _employer_app_obj,
        "SELECT * FROM employer_applications ORDER BY applied_at DESC", _write_employer_apps,
        _deleter("DELETE FROM employer_applications WHERE id = ANY(%s)"),
    ),
    "confidentialVault": ListSpec(
        "confidentialVault", lambda c: c.get("id"), _vault_obj,
        "SELECT * FROM confidential_candidates ORDER BY sort_order ASC, created_at DESC", _write_vault,
        _deleter("DELETE FROM confidential_candidates WHERE id = ANY(%s)"),
    ),
    "contactRequests": ListSpec(
        "contactRequests", lambda c: c.get("id"), _kv_obj,
        "SELECT key, data FROM app_kv WHERE namespace = 'contact' ORDER BY updated_at DESC LIMIT 1000",
        _kv_writer("contact"), _kv_deleter("contact"),
    ),
}


# --------------------------------------------------------------------------------------------------------------
# Keyed collections: one row (or one group of rows) per key
# --------------------------------------------------------------------------------------------------------------

def _upsert_profiles(conn, items: list[tuple[str, Any]]) -> None:
    rows = [{"email": k, "data": v} for k, v in items]
    conn.execute(
        """INSERT INTO profiles (email, user_id, data, updated_at)
           SELECT x.email, (SELECT u.id FROM users u WHERE u.email = x.email), x.data, NOW()
           FROM jsonb_to_recordset(%s::jsonb) AS x(email text, data jsonb)
           ON CONFLICT (email) DO UPDATE SET user_id = COALESCE(EXCLUDED.user_id, profiles.user_id),
             data = EXCLUDED.data, updated_at = NOW()""",
        _rs(rows),
    )


def _upsert_interviews(conn, items: list[tuple[str, Any]]) -> None:
    rows = []
    for email, payload in items:
        overall = None
        if isinstance(payload, dict) and "overall" in payload:
            try:
                overall = int(round(float(payload.get("overall") or 0)))
            except (TypeError, ValueError):
                overall = 0
        rows.append({"email": email, "overall": overall, "data": payload})
    conn.execute(
        """INSERT INTO interview_results (email, user_id, overall, data, updated_at)
           SELECT x.email, (SELECT u.id FROM users u WHERE u.email = x.email), x.overall, x.data, NOW()
           FROM jsonb_to_recordset(%s::jsonb) AS x(email text, overall int, data jsonb)
           ON CONFLICT (email) DO UPDATE SET user_id = COALESCE(EXCLUDED.user_id, interview_results.user_id),
             overall = EXCLUDED.overall, data = EXCLUDED.data, updated_at = NOW()""",
        _rs(rows),
    )


def _upsert_sessions(conn, items: list[tuple[str, Any]]) -> None:
    rows = [
        {"session_id": sid, "email": str((data or {}).get("email") or "").lower() or "unknown@local", "data": data}
        for sid, data in items
    ]
    conn.execute(
        # organization_id is filled from the session's data so recruiters can list their sessions by index.
        """INSERT INTO interview_sessions (session_id, email, user_id, organization_id, data, updated_at)
           SELECT x.session_id, x.email, (SELECT u.id FROM users u WHERE u.email = x.email),
             (SELECT o.id FROM organizations o WHERE o.id = x.data->>'organizationId'), x.data, NOW()
           FROM jsonb_to_recordset(%s::jsonb) AS x(session_id text, email text, data jsonb)
           ON CONFLICT (session_id) DO UPDATE SET email = EXCLUDED.email, data = EXCLUDED.data,
             organization_id = COALESCE(EXCLUDED.organization_id, interview_sessions.organization_id), updated_at = NOW()""",
        _rs(rows),
    )


def _upsert_applications(conn, items: list[tuple[str, Any]]) -> None:
    import random
    import string
    import time

    for email, lst in items:
        apps = [a for a in (lst or []) if isinstance(a, dict)]
        rows = []
        seen = set()
        for a in apps:
            app_id = str(a.get("id") or a.get("jobId") or "")
            if not app_id:
                app_id = f"app-{int(time.time() * 1000)}-{''.join(random.choices(string.ascii_lowercase + string.digits, k=7))}"
            if app_id in seen:
                continue
            seen.add(app_id)
            rows.append({"id": app_id, "email": email, "data": a, "created_at": a.get("appliedAt") or a.get("createdAt")})
        # Only THIS candidate's rows are replaced (it used to wipe the whole table on every save).
        conn.execute("DELETE FROM job_applications WHERE email = %s", (email,))
        if rows:
            conn.execute(
                """INSERT INTO job_applications (id, email, data, created_at)
                   SELECT id, email, data, COALESCE(created_at::timestamptz, NOW())
                   FROM jsonb_to_recordset(%s::jsonb) AS x(id text, email text, data jsonb, created_at timestamptz)""",
                _rs(rows),
            )


def _kv_upsert(namespace: str) -> Callable:
    def upsert(conn, items: list[tuple[str, Any]]) -> None:
        rows = [{"key": k, "data": v} for k, v in items]
        conn.execute(
            """INSERT INTO app_kv (namespace, key, data, updated_at)
               SELECT %s, x.key, x.data, NOW() FROM jsonb_to_recordset(%s::jsonb) AS x(key text, data jsonb)
               ON CONFLICT (namespace, key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()""",
            [namespace, *_rs(rows)],
        )

    return upsert


class KeyedSpec:
    def __init__(self, name: str, select_one: str, select_all: str, decode: Callable, upsert: Callable, delete_sql: str, multi: bool = False):
        self.name = name
        self.select_one = select_one  # one param: the key
        self.select_all = select_all  # rows with columns (k, v)
        self.decode = decode  # rows for one key -> value
        self.upsert = upsert
        self.delete_sql = delete_sql
        self.multi = multi


def _first_data(rows: list[dict]) -> Any:
    return rows[0]["data"] if rows else None


def _list_data(rows: list[dict]) -> Any:
    return [r["data"] for r in rows] if rows else None


KEYED_SPECS: dict[str, KeyedSpec] = {
    "profiles": KeyedSpec(
        "profiles", "SELECT data FROM profiles WHERE email = %s", "SELECT email AS k, data FROM profiles",
        _first_data, _upsert_profiles, "DELETE FROM profiles WHERE email = ANY(%s)",
    ),
    "interviews": KeyedSpec(
        "interviews", "SELECT data FROM interview_results WHERE email = %s", "SELECT email AS k, data FROM interview_results",
        _first_data, _upsert_interviews, "DELETE FROM interview_results WHERE email = ANY(%s)",
    ),
    "interviewSessions": KeyedSpec(
        "interviewSessions", "SELECT data FROM interview_sessions WHERE session_id = %s",
        "SELECT session_id AS k, data FROM interview_sessions",
        _first_data, _upsert_sessions, "DELETE FROM interview_sessions WHERE session_id = ANY(%s)",
    ),
    "applications": KeyedSpec(
        "applications", "SELECT data FROM job_applications WHERE email = %s ORDER BY created_at ASC",
        "SELECT email AS k, data FROM job_applications ORDER BY created_at ASC",
        _list_data, _upsert_applications, "DELETE FROM job_applications WHERE email = ANY(%s)", multi=True,
    ),
    "candidateJobAlerts": KeyedSpec(
        "candidateJobAlerts", "SELECT data FROM app_kv WHERE namespace = 'candidate_alerts' AND key = %s",
        "SELECT key AS k, data FROM app_kv WHERE namespace = 'candidate_alerts'",
        _first_data, _kv_upsert("candidate_alerts"), "DELETE FROM app_kv WHERE namespace = 'candidate_alerts' AND key = ANY(%s)",
    ),
    "employerApplicationAlerts": KeyedSpec(
        "employerApplicationAlerts", "SELECT data FROM app_kv WHERE namespace = 'employer_alerts' AND key = %s",
        "SELECT key AS k, data FROM app_kv WHERE namespace = 'employer_alerts'",
        _first_data, _kv_upsert("employer_alerts"), "DELETE FROM app_kv WHERE namespace = 'employer_alerts' AND key = ANY(%s)",
    ),
}


_warned: set[str] = set()


def _warn_full_scan(name: str) -> None:
    """A whole table was loaded. Fine for tiny tables; for big ones it means a call site still needs a finder."""
    if name in ("subscriptionPlans",):
        return
    caller = "".join(traceback.format_stack(limit=6)[:-2]).strip().splitlines()
    where = caller[-2].strip() if len(caller) >= 2 else "?"
    key = f"{name}:{where}"
    if key not in _warned:
        _warned.add(key)
        _log.warning("Full table load of %s (add an indexed finder for this call site): %s", name, where)


class KeyedTable(MutableMapping):
    """dict-like view over one table, keyed (email / session id / org id). Loads each key on first access."""

    def __init__(self, uow: "UnitOfWork", spec: KeyedSpec) -> None:
        self._uow = uow
        self._spec = spec
        self._values: dict[str, Any] = {}
        self._snaps: dict[str, str] = {}
        self._missing: set[str] = set()
        self._deleted: set[str] = set()
        self._full = False

    def _load(self, key: Any) -> None:
        if key is None:
            return
        key = str(key)
        if key in self._values or key in self._missing or key in self._deleted or self._full:
            return
        rows = self._uow.query(self._spec.select_one, (key,))
        value = self._spec.decode(rows)
        if value is None:
            self._missing.add(key)
        else:
            self._values[key] = value
            self._snaps[key] = _snap(value)

    def prime(self, key: str, value: Any) -> Any:
        """Register a value that a finder already loaded; returns the tracked object."""
        key = str(key)
        if key in self._values:
            return self._values[key]
        if key in self._deleted:
            return value
        self._values[key] = value
        self._snaps[key] = _snap(value)
        self._missing.discard(key)
        return value

    def _load_all(self) -> None:
        if self._full:
            return
        _warn_full_scan(self._spec.name)
        rows = self._uow.query(self._spec.select_all, ())
        grouped: dict[str, list] = {}
        for r in rows:
            grouped.setdefault(str(r["k"]), []).append(r)
        for k, group in grouped.items():
            if k in self._values or k in self._deleted:
                continue
            value = self._spec.decode(group)
            if value is not None:
                self._values[k] = value
                self._snaps[k] = _snap(value)
        self._full = True

    # Mapping API ------------------------------------------------------------------------------------------------
    def __bool__(self) -> bool:  # `db.get("profiles") or {}` must not load the whole table
        return True

    def __getitem__(self, key: Any) -> Any:
        self._load(key)
        return self._values[str(key)]

    def __contains__(self, key: object) -> bool:
        self._load(key)
        return str(key) in self._values

    def __setitem__(self, key: Any, value: Any) -> None:
        key = str(key)
        self._values[key] = value
        self._deleted.discard(key)
        self._missing.discard(key)

    def __delitem__(self, key: Any) -> None:
        self._load(key)
        key = str(key)
        if key not in self._values:
            raise KeyError(key)
        del self._values[key]
        self._snaps.pop(key, None)
        self._deleted.add(key)

    def __iter__(self):
        self._load_all()
        return iter(list(self._values))

    def __len__(self) -> int:
        self._load_all()
        return len(self._values)

    def __repr__(self) -> str:
        return f"<KeyedTable {self._spec.name} loaded={len(self._values)}>"

    # Unit of work ------------------------------------------------------------------------------------------------
    def changes(self) -> tuple[list[tuple[str, Any]], list[str]]:
        changed = [(k, v) for k, v in self._values.items() if _snap(v) != self._snaps.get(k)]
        return changed, sorted(self._deleted)

    def mark_clean(self) -> None:
        self._snaps = {k: _snap(v) for k, v in self._values.items()}
        self._deleted.clear()


class EntityList(MutableSequence):
    """list-like view over one table. Rows found by finders are tracked; iterating loads the whole table."""

    def __init__(self, uow: "UnitOfWork", spec: ListSpec) -> None:
        self._uow = uow
        self._spec = spec
        self._items: list[dict] = []
        self._by_key: dict[Any, dict] = {}
        self._snaps: dict[int, str] = {}  # id(obj) -> snapshot at load; new objects have no snapshot
        self._deleted: dict[Any, dict] = {}
        self._full = False

    # tracking ----------------------------------------------------------------------------------------------------
    def track_rows(self, rows: Iterable[dict]) -> list[dict]:
        """Map DB rows to objects, reusing objects already tracked in this request. Returns them in row order."""
        out = []
        for r in rows:
            obj = self._spec.to_obj(r)
            key = self._spec.key(obj)
            if key in self._deleted:
                continue
            existing = self._by_key.get(key)
            if existing is not None:
                out.append(existing)
                continue
            self._items.append(obj)
            self._by_key[key] = obj
            self._snaps[id(obj)] = _snap(obj)
            out.append(obj)
        return out

    def _ensure_full(self) -> None:
        if self._full:
            return
        _warn_full_scan(self._spec.name)
        rows = self._uow.query(self._spec.select_all, self._spec.select_params)
        loaded = self.track_rows(rows)
        # keep table order for the loaded rows, then anything new added in this request
        seen = {id(o) for o in loaded}
        self._items = loaded + [o for o in self._items if id(o) not in seen]
        self._full = True

    def is_fully_loaded(self) -> bool:
        return self._full

    def tracked(self) -> list[dict]:
        """Objects already loaded in this request (no query)."""
        return list(self._items)

    # MutableSequence API -----------------------------------------------------------------------------------------
    def __bool__(self) -> bool:
        return True

    def __len__(self) -> int:
        self._ensure_full()
        return len(self._items)

    def __iter__(self):
        self._ensure_full()
        return iter(list(self._items))

    def __getitem__(self, index):
        self._ensure_full()
        return self._items[index]

    def __setitem__(self, index, value) -> None:
        self._ensure_full()
        if isinstance(index, slice):
            raise TypeError("slice assignment is not supported on a database collection")
        old = self._items[index]
        self._items[index] = value
        self._by_key.pop(self._spec.key(old), None)
        self._by_key[self._spec.key(value)] = value

    def __delitem__(self, index) -> None:
        self._ensure_full()
        targets = self._items[index] if isinstance(index, slice) else [self._items[index]]
        for obj in list(targets):
            self.remove_obj(obj)

    def insert(self, index: int, value: dict) -> None:
        # Adding never needs the whole table: the new object is simply tracked and written on flush.
        key = self._spec.key(value)
        self._deleted.pop(key, None)
        existing = self._by_key.get(key)
        if existing is not None and existing is not value:
            self._items = [o for o in self._items if o is not existing]
        self._by_key[key] = value
        if index <= 0:
            self._items.insert(0, value)
        else:
            self._items.append(value)

    def append(self, value: dict) -> None:
        self.insert(len(self._items) + 1, value)

    def remove_obj(self, obj: dict) -> None:
        key = self._spec.key(obj)
        self._items = [o for o in self._items if o is not obj]
        if self._by_key.get(key) is obj:
            del self._by_key[key]
        if id(obj) in self._snaps:  # it exists in the database
            self._deleted[key] = obj

    def replace_all(self, new_items: list[dict]) -> None:
        """`db["jobs"] = [...]`: objects that were loaded and are no longer present are deleted."""
        new_ids = {id(o) for o in new_items}
        if self._full:
            for obj in list(self._items):
                if id(obj) not in new_ids:
                    self.remove_obj(obj)
        for obj in new_items:
            key = self._spec.key(obj)
            existing = self._by_key.get(key)
            if existing is obj:
                continue
            if existing is not None:
                self._items = [o for o in self._items if o is not existing]
                # keep the old snapshot so an unchanged replacement is not rewritten
                if id(existing) in self._snaps:
                    self._snaps[id(obj)] = self._snaps[id(existing)]
            self._deleted.pop(key, None)
            self._items.append(obj)
            self._by_key[key] = obj

    def __repr__(self) -> str:
        return f"<EntityList {self._spec.name} loaded={len(self._items)} full={self._full}>"

    # Unit of work ------------------------------------------------------------------------------------------------
    def changes(self) -> tuple[list[dict], list[dict]]:
        changed = [o for o in self._items if _snap(o) != self._snaps.get(id(o))]
        return changed, list(self._deleted.values())

    def mark_clean(self) -> None:
        self._snaps = {id(o): _snap(o) for o in self._items}
        self._deleted.clear()


class UnitOfWork(dict):
    """The `db` object routes receive. Collections are created lazily; nothing is queried until it is used."""

    def __init__(self, database_url: str) -> None:
        super().__init__()
        self.database_url = database_url
        self._lock = threading.RLock()
        self.fetched: dict[tuple, list[dict]] = {}  # finder query -> objects, so a request never repeats a query

    # dict API ------------------------------------------------------------------------------------------------------
    def _collection(self, name: str) -> Any:
        if not dict.__contains__(self, name):
            if name in LIST_SPECS:
                dict.__setitem__(self, name, EntityList(self, LIST_SPECS[name]))
            elif name in KEYED_SPECS:
                dict.__setitem__(self, name, KeyedTable(self, KEYED_SPECS[name]))
            else:
                return None
        return dict.__getitem__(self, name)

    def __getitem__(self, name: str) -> Any:
        found = self._collection(name)
        if found is None:
            return dict.__getitem__(self, name)
        return found

    def get(self, name: str, default: Any = None) -> Any:
        found = self._collection(name)
        if found is None:
            return dict.get(self, name, default)
        return found

    def setdefault(self, name: str, default: Any = None) -> Any:
        found = self._collection(name)
        if found is None:
            return dict.setdefault(self, name, default)
        return found

    def __contains__(self, name: object) -> bool:
        return isinstance(name, str) and (name in LIST_SPECS or name in KEYED_SPECS or dict.__contains__(self, name))

    def __setitem__(self, name: str, value: Any) -> None:
        coll = self._collection(name)
        if isinstance(coll, EntityList):
            if value is coll:
                return
            coll.replace_all(list(value or []))
            return
        if isinstance(coll, KeyedTable):
            if value is coll:
                return
            new = dict(value or {})
            for k in list(coll._values):
                if k not in new:
                    del coll[k]
            for k, v in new.items():
                coll[k] = v
            return
        dict.__setitem__(self, name, value)

    # database ------------------------------------------------------------------------------------------------------
    def query(self, sql: str, params: tuple | list = ()) -> list[dict]:
        from app.db.store import _ensure_pool, _ensure_schema

        _ensure_schema(self.database_url)
        pool = _ensure_pool(self.database_url)
        with pool.connection() as conn:
            return list(conn.execute(sql, params).fetchall())

    def list(self, name: str) -> EntityList:
        return self._collection(name)

    def keyed(self, name: str) -> KeyedTable:
        return self._collection(name)

    def flush(self) -> int:
        """Write every changed / new / deleted object in one transaction. Returns the number of objects written."""
        from app.db.store import _ensure_pool, _ensure_schema

        with self._lock:
            plan: list[tuple[Callable, Any]] = []
            touched: list[Any] = []
            # parents before children (foreign keys)
            order = [
                "organizations", "users", "organizationMembers", "organizationSubscriptions", "jobs",
                "employerApplications", "confidentialVault", "contactRequests",
            ]
            count = 0
            for name in order:
                coll = dict.get(self, name)
                if not isinstance(coll, EntityList):
                    continue
                changed, deleted = coll.changes()
                spec = coll._spec
                if changed and spec.writer:
                    plan.append((spec.writer, changed))
                    count += len(changed)
                if deleted and spec.deleter:
                    keys = [spec.delete_key(o) for o in deleted if spec.delete_key(o)]
                    if keys:
                        plan.append((spec.deleter, keys))
                        count += len(keys)
                touched.append(coll)
            for name, spec in KEYED_SPECS.items():
                coll = dict.get(self, name)
                if not isinstance(coll, KeyedTable):
                    continue
                changed, deleted = coll.changes()
                if changed:
                    plan.append((spec.upsert, changed))
                    count += len(changed)
                if deleted:
                    plan.append((_deleter(spec.delete_sql), deleted))
                    count += len(deleted)
                touched.append(coll)
            if not plan:
                return 0
            _ensure_schema(self.database_url)
            pool = _ensure_pool(self.database_url)
            with pool.connection() as conn:
                with conn.transaction():
                    for fn, arg in plan:
                        fn(conn, arg)
            for coll in touched:
                coll.mark_clean()
            return count


# --------------------------------------------------------------------------------------------------------------
# Request scoping
# --------------------------------------------------------------------------------------------------------------

_current: contextvars.ContextVar[UnitOfWork | None] = contextvars.ContextVar("hireright_uow", default=None)


def current_uow(database_url: str) -> UnitOfWork:
    uow = _current.get()
    if uow is None or uow.database_url != database_url:
        uow = UnitOfWork(database_url)
        _current.set(uow)
    return uow


def new_uow(database_url: str) -> UnitOfWork:
    """Start a fresh unit of work for this context (each HTTP request, each background job)."""
    uow = UnitOfWork(database_url)
    _current.set(uow)
    return uow


class UnitOfWorkMiddleware:
    """Pure ASGI middleware: every HTTP request gets its own unit of work (child tasks inherit it)."""

    def __init__(self, app, database_url_fn: Callable[[], str]) -> None:
        self.app = app
        self._url = database_url_fn

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)
        token = _current.set(UnitOfWork(self._url()))
        try:
            return await self.app(scope, receive, send)
        finally:
            _current.reset(token)
