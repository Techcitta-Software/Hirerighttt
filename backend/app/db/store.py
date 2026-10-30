"""
PostgreSQL document cache — port of backend/node/db/store.mjs.
In-memory DbShape synced to Neon on save_db().
"""

from __future__ import annotations

import copy
import json
import random
import string
import threading
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

import certifi
import psycopg
from psycopg import Connection
from psycopg.conninfo import make_conninfo
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app.db.apply_schema import apply_schema
from app.db.resolve_pg_host import resolve_pg_host

_pool: ConnectionPool | None = None
_pool_lock = threading.Lock()
_schema_ready = False
_schema_lock = threading.Lock()
_save_queue: list[Any] = []
_save_lock = threading.Lock()
_persisted_rows: dict[str, dict[str, str]] = {}


def empty_db() -> dict[str, Any]:
    return {
        "users": [],
        "profiles": {},
        "interviews": {},
        "applications": {},
        "interviewSessions": {},
        "confidentialVault": [],
        "organizations": [],
        "organizationMembers": [],
        "organizationSubscriptions": [],
        "subscriptionPlans": [],
        "jobs": [],
        "employerApplications": [],
        "candidateJobAlerts": {},
        "employerApplicationAlerts": {},
    }


def _require_database_url(database_url: str) -> str:
    url = (database_url or "").strip()
    if not url:
        raise RuntimeError(
            "DATABASE_URL is required. Set Neon PostgreSQL in repo-root .env (see .env.example)"
        )
    return url


def _pg_ssl(database_url: str) -> str | None:
    if "sslmode=require" in database_url.lower() or "neon.tech" in database_url or "amazonaws.com" in database_url:
        return "require"
    return None


def _pool_conninfo(database_url: str) -> str:
    url = _require_database_url(database_url)
    parsed = urlparse(url)
    hostname = parsed.hostname or "localhost"
    host, servername = resolve_pg_host(hostname)
    query = parse_qs(parsed.query)
    channel_binding = (query.get("channel_binding") or [None])[0]
    kwargs: dict[str, Any] = {
        "port": parsed.port or 5432,
        "dbname": unquote(parsed.path.lstrip("/")),
    }
    if parsed.username:
        kwargs["user"] = unquote(parsed.username)
    if parsed.password:
        kwargs["password"] = unquote(parsed.password)
    if servername:
        kwargs["host"] = servername
        kwargs["hostaddr"] = host
        kwargs["sslmode"] = "verify-full"
        kwargs["sslrootcert"] = certifi.where()
    else:
        kwargs["host"] = host
        sslmode = _pg_ssl(url)
        if sslmode:
            kwargs["sslmode"] = sslmode
    if channel_binding:
        kwargs["channel_binding"] = channel_binding
    return make_conninfo(**kwargs)


def _ensure_pool(database_url: str) -> ConnectionPool:
    global _pool
    with _pool_lock:
        if _pool is None:
            _pool = ConnectionPool(
                conninfo=_pool_conninfo(database_url),
                min_size=1,
                max_size=10,
                kwargs={"row_factory": dict_row},
                open=True,
            )
        return _pool


def _ensure_schema(database_url: str) -> None:
    global _schema_ready
    with _schema_lock:
        if _schema_ready:
            return
        pool = _ensure_pool(database_url)
        with pool.connection() as conn:
            apply_schema(conn)
            conn.commit()
        _schema_ready = True


def _iso(value: Any) -> str:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat().replace("+00:00", "Z")
    return str(value)


def _map_job_row(r: dict[str, Any]) -> dict[str, Any]:
    extras = r.get("extras") if isinstance(r.get("extras"), dict) else {}
    return {
        "id": r["id"],
        "organizationId": r["organization_id"],
        "createdByUserId": r.get("created_by_user_id") or None,
        "title": r["title"],
        "company": r["company"],
        "companySlug": extras.get("companySlug"),
        "roleTrack": r.get("role_track") or "",
        "experienceLevel": r.get("experience_level") or "",
        "location": r.get("location") or "",
        "jobDescription": r.get("job_description") or "",
        "requiredSkills": r.get("required_skills") or [],
        "shareableCode": r["shareable_code"],
        "status": r.get("status"),
        "createdAt": _iso(r["created_at"]),
        "createdByEmail": extras.get("createdByEmail") or "",
    }


def _load_relational(conn: Connection) -> dict[str, Any]:
    db = empty_db()
    cur = conn.cursor()

    cur.execute(
        """SELECT id, code, name, description, price_cents_monthly, price_cents_yearly, currency,
                  limits, features, is_public, sort_order
           FROM subscription_plans ORDER BY sort_order ASC"""
    )
    for r in cur.fetchall():
        db["subscriptionPlans"].append(
            {
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
        )

    cur.execute(
        """SELECT id, name, slug, logo_url, website, billing_email, status, settings, created_at, updated_at
           FROM organizations ORDER BY created_at ASC"""
    )
    for r in cur.fetchall():
        db["organizations"].append(
            {
                "id": r["id"],
                "name": r["name"],
                "slug": r["slug"],
                "logoUrl": r.get("logo_url"),
                "website": r.get("website"),
                "billingEmail": r.get("billing_email"),
                "status": r["status"],
                "settings": r.get("settings") or {},
                "createdAt": _iso(r["created_at"]),
                "updatedAt": _iso(r["updated_at"]),
            }
        )

    cur.execute("SELECT * FROM organization_subscriptions")
    for r in cur.fetchall():
        db["organizationSubscriptions"].append(
            {
                "id": r["id"],
                "organizationId": r["organization_id"],
                "planId": r["plan_id"],
                "status": r["status"],
                "trialEndsAt": _iso(r["trial_ends_at"]) if r.get("trial_ends_at") else None,
                "currentPeriodStart": _iso(r["current_period_start"]) if r.get("current_period_start") else None,
                "currentPeriodEnd": _iso(r["current_period_end"]) if r.get("current_period_end") else None,
                "stripeCustomerId": r.get("stripe_customer_id"),
                "stripeSubscriptionId": r.get("stripe_subscription_id"),
                "createdAt": _iso(r["created_at"]),
                "updatedAt": _iso(r["updated_at"]),
            }
        )

    cur.execute(
        """SELECT id, email, name, password_hash, role, company_name, primary_organization_id, status, phone, created_at
           FROM users ORDER BY created_at ASC"""
    )
    for r in cur.fetchall():
        db["users"].append(
            {
                "id": r["id"],
                "email": r["email"],
                "name": r["name"],
                "passwordHash": r["password_hash"],
                "role": r.get("role"),
                "companyName": r.get("company_name"),
                "primaryOrganizationId": r.get("primary_organization_id"),
                "status": r.get("status") or "active",
                "phone": r.get("phone"),
                "createdAt": _iso(r["created_at"]),
            }
        )

    cur.execute("SELECT * FROM organization_members")
    for r in cur.fetchall():
        db["organizationMembers"].append(
            {
                "id": r["id"],
                "organizationId": r["organization_id"],
                "userId": r["user_id"],
                "role": r["role"],
                "invitedByUserId": r.get("invited_by_user_id"),
                "joinedAt": _iso(r["joined_at"]),
            }
        )

    cur.execute("SELECT * FROM jobs ORDER BY created_at DESC")
    db["jobs"] = [_map_job_row(r) for r in cur.fetchall()]

    cur.execute("SELECT * FROM employer_applications ORDER BY applied_at DESC")
    for r in cur.fetchall():
        db["employerApplications"].append(
            {
                "id": r["id"],
                "organizationId": r["organization_id"],
                "jobId": r["job_id"],
                "candidateEmail": r["candidate_email"],
                "candidateUserId": r.get("candidate_user_id"),
                "status": r["status"],
                "data": r.get("data") or {},
                "appliedAt": _iso(r["applied_at"]),
            }
        )

    cur.execute("SELECT email, data FROM profiles")
    for r in cur.fetchall():
        db["profiles"][r["email"]] = r["data"]

    cur.execute("SELECT email, data FROM interview_results")
    for r in cur.fetchall():
        db["interviews"][r["email"]] = r["data"]

    cur.execute("SELECT email, id, data FROM job_applications ORDER BY created_at ASC")
    for r in cur.fetchall():
        db["applications"].setdefault(r["email"], []).append(r["data"])

    cur.execute("SELECT session_id, data FROM interview_sessions")
    for r in cur.fetchall():
        db["interviewSessions"][r["session_id"]] = r["data"]

    cur.execute(
        "SELECT id, organization_id, data FROM confidential_candidates ORDER BY sort_order ASC, created_at DESC"
    )
    for r in cur.fetchall():
        item = dict(r["data"]) if isinstance(r.get("data"), dict) else {}
        item["id"] = r["id"]
        item["organizationId"] = r["organization_id"]
        db["confidentialVault"].append(item)

    return db


def load_db(database_url: str) -> dict[str, Any]:
    url = _require_database_url(database_url)
    _ensure_schema(url)
    pool = _ensure_pool(url)
    with pool.connection() as conn:
        return _load_relational(conn)


def _user_id_for_email(db: dict[str, Any], email: str) -> str | None:
    for u in db.get("users") or []:
        if u.get("email") == email:
            return u.get("id")
    return None


def _dedupe_by(rows: list[dict], key_fn) -> list[dict]:
    out: dict[Any, dict] = {}
    for row in rows:
        out[key_fn(row)] = row
    return list(out.values())


def _recordset(rows: list[dict]) -> list[Any]:
    return [json.dumps(rows)]


def _diff_rows(table: str, rows: list[dict], key_fn) -> tuple[list[dict], list[dict], bool]:
    global _persisted_rows
    prev = _persisted_rows.get(table)
    current: dict[str, str] = {}
    for row in rows:
        current[key_fn(row)] = json.dumps(row, default=str)
    changed = [row for row in rows if not prev or prev.get(key_fn(row)) != current.get(key_fn(row))]
    removed = bool(prev and any(k not in current for k in prev))
    _persisted_rows[table] = current
    return rows, changed, removed


def _random_app_id() -> str:
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=7))
    return f"app-{int(time.time() * 1000)}-{suffix}"


def _save_relational(conn: Connection, db: dict[str, Any]) -> None:
    global _persisted_rows
    next_persisted: dict[str, dict[str, str]] = {}
    statements: list[tuple[str, list[Any]]] = []

    org_rows = _dedupe_by(
        [
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
            for o in db.get("organizations") or []
        ],
        lambda r: r["id"],
    )
    _, changed, _ = _diff_rows("organizations", org_rows, lambda r: r["id"])
    if changed:
        statements.append(
            (
                """INSERT INTO organizations (id, name, slug, logo_url, website, billing_email, status, settings, created_at, updated_at)
                   SELECT id, name, slug, logo_url, website, billing_email, status, settings,
                     COALESCE(created_at::timestamptz, NOW()), COALESCE(updated_at::timestamptz, NOW())
                   FROM jsonb_to_recordset(%s::jsonb) AS x(id text, name text, slug text, logo_url text, website text,
                     billing_email text, status text, settings jsonb, created_at timestamptz, updated_at timestamptz)
                   ON CONFLICT (id) DO UPDATE SET
                     name = EXCLUDED.name, slug = EXCLUDED.slug, logo_url = EXCLUDED.logo_url,
                     website = EXCLUDED.website, billing_email = EXCLUDED.billing_email,
                     status = EXCLUDED.status, settings = EXCLUDED.settings, updated_at = EXCLUDED.updated_at""",
                _recordset(changed),
            )
        )

    user_rows = _dedupe_by(
        [
            {
                "id": u["id"],
                "email": u["email"],
                "name": u["name"],
                "password_hash": u["passwordHash"],
                "role": u.get("role") or "jobseeker",
                "company_name": u.get("companyName"),
                "primary_organization_id": u.get("primaryOrganizationId"),
                "status": u.get("status") or "active",
                "phone": u.get("phone"),
                "created_at": u.get("createdAt"),
            }
            for u in db.get("users") or []
        ],
        lambda r: r["email"],
    )
    _, changed, _ = _diff_rows("users", user_rows, lambda r: r["email"])
    if changed:
        statements.append(
            (
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
                _recordset(changed),
            )
        )

    profile_rows = [
        {"email": email, "user_id": _user_id_for_email(db, email), "data": db["profiles"].get(email)}
        for email in db.get("profiles") or {}
    ]
    _, changed, _ = _diff_rows("profiles", profile_rows, lambda r: r["email"])
    if changed:
        statements.append(
            (
                """INSERT INTO profiles (email, user_id, data, updated_at)
                   SELECT email, user_id, data, NOW()
                   FROM jsonb_to_recordset(%s::jsonb) AS x(email text, user_id text, data jsonb)
                   ON CONFLICT (email) DO UPDATE SET user_id = EXCLUDED.user_id, data = EXCLUDED.data, updated_at = NOW()""",
                _recordset(changed),
            )
        )

    app_rows: list[dict] = []
    for email, items in (db.get("applications") or {}).items():
        if not isinstance(items, list):
            continue
        for item in items:
            app_rows.append(
                {
                    "id": str(item.get("id") or item.get("jobId") or _random_app_id()),
                    "email": email,
                    "data": item,
                    "created_at": item.get("appliedAt") or item.get("createdAt"),
                }
            )
    app_rows = _dedupe_by(app_rows, lambda r: f"{r['email']}\0{r['id']}")
    _, changed, removed = _diff_rows("job_applications", app_rows, lambda r: f"{r['email']}\0{r['id']}")
    if removed or changed:
        statements.append(("DELETE FROM job_applications", []))
        if app_rows:
            statements.append(
                (
                    """INSERT INTO job_applications (id, email, data, created_at)
                       SELECT id, email, data, COALESCE(created_at::timestamptz, NOW())
                       FROM jsonb_to_recordset(%s::jsonb) AS x(id text, email text, data jsonb, created_at timestamptz)""",
                    _recordset(app_rows),
                )
            )

    result_rows = []
    for email, payload in (db.get("interviews") or {}).items():
        overall = None
        if isinstance(payload, dict) and "overall" in payload:
            try:
                overall = int(payload.get("overall") or 0)
            except (TypeError, ValueError):
                overall = 0
        result_rows.append(
            {
                "email": email,
                "user_id": _user_id_for_email(db, email),
                "overall": overall,
                "data": payload,
            }
        )
    _, changed, _ = _diff_rows("interview_results", result_rows, lambda r: r["email"])
    if changed:
        statements.append(
            (
                """INSERT INTO interview_results (email, user_id, overall, data, updated_at)
                   SELECT email, user_id, round(overall)::int, data, NOW()
                   FROM jsonb_to_recordset(%s::jsonb) AS x(email text, user_id text, overall numeric, data jsonb)
                   ON CONFLICT (email) DO UPDATE SET user_id = EXCLUDED.user_id, overall = EXCLUDED.overall, data = EXCLUDED.data, updated_at = NOW()""",
                _recordset(changed),
            )
        )

    session_rows = []
    for session_id, data in (db.get("interviewSessions") or {}).items():
        email = str((data or {}).get("email") or "")
        session_rows.append(
            {
                "session_id": session_id,
                "email": email or "unknown@local",
                "user_id": _user_id_for_email(db, email),
                "data": data,
            }
        )
    _, changed, _ = _diff_rows("interview_sessions", session_rows, lambda r: r["session_id"])
    if changed:
        statements.append(
            (
                """INSERT INTO interview_sessions (session_id, email, user_id, data, updated_at)
                   SELECT session_id, email, user_id, data, NOW()
                   FROM jsonb_to_recordset(%s::jsonb) AS x(session_id text, email text, user_id text, data jsonb)
                   ON CONFLICT (session_id) DO UPDATE SET email = EXCLUDED.email, data = EXCLUDED.data, updated_at = NOW()""",
                _recordset(changed),
            )
        )

    if not statements:
        _persisted_rows = next_persisted
        return

    with conn.transaction():
        for sql, params in statements:
            if params:
                conn.execute(sql, params)
            else:
                conn.execute(sql)
    _persisted_rows = next_persisted


_queued_save: dict[str, Any] | None = None


def save_db(db: dict[str, Any], database_url: str) -> None:
    global _queued_save
    url = _require_database_url(database_url)
    snapshot = copy.deepcopy(db)
    if _queued_save:
        _queued_save["snapshot"] = snapshot
        _queued_save["database_url"] = url
        return
    job: dict[str, Any] = {"snapshot": snapshot, "database_url": url}

    def _run() -> None:
        global _queued_save
        try:
            _ensure_schema(job["database_url"])
            pool = _ensure_pool(job["database_url"])
            with pool.connection() as conn:
                _save_relational(conn, job["snapshot"])
        finally:
            if _queued_save is job:
                _queued_save = None

    with _save_lock:
        if _queued_save is None:
            _queued_save = job
            _run()


def ping_database(database_url: str) -> dict[str, Any]:
    try:
        url = _require_database_url(database_url)
        pool = _ensure_pool(url)
        with pool.connection() as conn:
            row = conn.execute("SELECT 1 AS ok").fetchone()
        return {"ok": row and row.get("ok") == 1}
    except Exception as exc:
        return {"ok": False, "reason": str(exc)}


def save_session_token(database_url: str, token: str, email: str, ttl_ms: int = 7 * 24 * 60 * 60 * 1000) -> None:
    url = _require_database_url(database_url)
    expires = datetime.now(timezone.utc).timestamp() + ttl_ms / 1000
    expires_dt = datetime.fromtimestamp(expires, tz=timezone.utc)
    pool = _ensure_pool(url)
    with pool.connection() as conn:
        conn.execute(
            """INSERT INTO hireright_sessions (token, email, expires_at) VALUES (%s, %s, %s)
               ON CONFLICT (token) DO UPDATE SET email = EXCLUDED.email, expires_at = EXCLUDED.expires_at""",
            (token, email, expires_dt),
        )
        conn.commit()


def resolve_session_email(database_url: str, token: str) -> str | None:
    if not token:
        return None
    url = _require_database_url(database_url)
    pool = _ensure_pool(url)
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT email FROM hireright_sessions WHERE token = %s AND expires_at > NOW()",
            (token,),
        ).fetchone()
    return row["email"] if row else None


def delete_session_token(database_url: str, token: str) -> None:
    if not token:
        return
    url = _require_database_url(database_url)
    pool = _ensure_pool(url)
    with pool.connection() as conn:
        conn.execute("DELETE FROM hireright_sessions WHERE token = %s", (token,))
        conn.commit()


def append_interview_history(database_url: str, email: str, data: dict, ctx: dict | None = None) -> None:
    if not email or not data:
        return
    url = _require_database_url(database_url)
    ctx = ctx or {}
    overall = int(data.get("overall") or 0) if isinstance(data, dict) else None
    pool = _ensure_pool(url)
    with pool.connection() as conn:
        conn.execute(
            """INSERT INTO interview_result_history (email, user_id, organization_id, job_id, overall, data)
               VALUES (%s, %s, %s, %s, %s, %s::jsonb)""",
            (
                email,
                ctx.get("userId"),
                ctx.get("organizationId"),
                ctx.get("jobId"),
                overall,
                json.dumps(data),
            ),
        )
        conn.commit()


def db_pool(database_url: str) -> ConnectionPool:
    url = _require_database_url(database_url)
    return _ensure_pool(url)


def close_store() -> None:
    global _pool, _schema_ready, _persisted_rows
    if _pool:
        _pool.close()
        _pool = None
    _schema_ready = False
    _persisted_rows = {}


# --- Additional helpers used by api dispatch (direct Postgres) ---


def sync_open_jobs_from_database(database_url: str, db: dict[str, Any]) -> dict[str, Any]:
    if not database_url.strip():
        return db
    _ensure_schema(database_url)
    pool = _ensure_pool(database_url)
    with pool.connection() as conn:
        rows = conn.execute(
            """SELECT * FROM jobs
               WHERE COALESCE(status, 'published') IN ('active', 'published')
               ORDER BY created_at DESC"""
        ).fetchall()
    from_pg = [_map_job_row(r) for r in rows]
    by_id = {j["id"]: j for j in db.get("jobs") or []}
    for job in from_pg:
        by_id[job["id"]] = {**by_id.get(job["id"], {}), **job}
    db["jobs"] = list(by_id.values())
    return db


def upsert_job_record(database_url: str, job: dict[str, Any]) -> None:
    if not job.get("id") or not job.get("shareableCode"):
        return
    _ensure_schema(database_url)
    extras = {"createdByEmail": job.get("createdByEmail") or "", "companySlug": job.get("companySlug")}
    pool = _ensure_pool(database_url)
    with pool.connection() as conn:
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
                job["title"],
                job["company"],
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
        conn.commit()


def sync_org_jobs_from_database(database_url: str, db: dict[str, Any], organization_id: str) -> dict[str, Any]:
    org_id = str(organization_id or "").strip()
    if not database_url.strip() or not org_id:
        return db
    _ensure_schema(database_url)
    pool = _ensure_pool(database_url)
    with pool.connection() as conn:
        rows = conn.execute(
            """SELECT * FROM jobs
               WHERE organization_id = %s
                 AND COALESCE(status, 'published') NOT IN ('archived', 'deleted')
               ORDER BY created_at DESC""",
            (org_id,),
        ).fetchall()
    from_pg = [_map_job_row(r) for r in rows]
    by_id = {j["id"]: j for j in db.get("jobs") or []}
    for job in from_pg:
        by_id[job["id"]] = {**by_id.get(job["id"], {}), **job}
    db["jobs"] = list(by_id.values())
    return db


def find_job_by_shareable_code(database_url: str, shareable_code: str) -> dict[str, Any] | None:
    code = str(shareable_code or "").strip().lower()
    if not code or not database_url.strip():
        return None
    _ensure_schema(database_url)
    pool = _ensure_pool(database_url)
    with pool.connection() as conn:
        row = conn.execute(
            """SELECT * FROM jobs
               WHERE LOWER(shareable_code) = %s
                 AND COALESCE(status, 'published') IN ('active', 'published')
               LIMIT 1""",
            (code,),
        ).fetchone()
    return _map_job_row(row) if row else None


def delete_job_record(database_url: str, job_id: str, organization_id: str) -> bool:
    jid = str(job_id or "").strip()
    org_id = str(organization_id or "").strip()
    if not jid or not org_id or not database_url.strip():
        return False
    _ensure_schema(database_url)
    pool = _ensure_pool(database_url)
    with pool.connection() as conn:
        cur = conn.execute(
            "DELETE FROM jobs WHERE id = %s AND organization_id = %s",
            (jid, org_id),
        )
        conn.commit()
        return (cur.rowcount or 0) > 0


def sync_employer_applications_from_database(database_url: str, db: dict[str, Any]) -> dict[str, Any]:
    if not database_url.strip():
        return db
    _ensure_schema(database_url)
    pool = _ensure_pool(database_url)
    with pool.connection() as conn:
        rows = conn.execute("SELECT * FROM employer_applications ORDER BY applied_at DESC").fetchall()
    from_pg = [
        {
            "id": r["id"],
            "organizationId": r["organization_id"],
            "jobId": r["job_id"],
            "candidateEmail": r["candidate_email"],
            "candidateUserId": r.get("candidate_user_id"),
            "status": r["status"],
            "data": r.get("data") or {},
            "appliedAt": _iso(r["applied_at"]),
        }
        for r in rows
    ]
    by_id = {a["id"]: a for a in db.get("employerApplications") or []}
    for app in from_pg:
        by_id[app["id"]] = {**by_id.get(app["id"], {}), **app}
    db["employerApplications"] = list(by_id.values())
    return db


def upsert_job_application_record(database_url: str, email: str, record: dict[str, Any]) -> None:
    if not database_url.strip() or not email or not record.get("id"):
        return
    _ensure_schema(database_url)
    applied_at = record.get("appliedAt") or datetime.now(timezone.utc).isoformat()
    pool = _ensure_pool(database_url)
    with pool.connection() as conn:
        conn.execute(
            """INSERT INTO job_applications (id, email, data, created_at)
               VALUES (%s, %s, %s::jsonb, %s::timestamptz)
               ON CONFLICT (email, id) DO UPDATE SET
                 data = EXCLUDED.data,
                 created_at = EXCLUDED.created_at""",
            (record["id"], str(email).strip().lower(), json.dumps(record), applied_at),
        )
        conn.commit()


def mark_job_applications_deleted_in_postgres(database_url: str, job_id: str, patch: dict | None = None) -> int:
    jid = str(job_id or "").strip()
    if not database_url.strip() or not jid:
        return 0
    patch = patch or {}
    merged = {
        "jobStatus": "deleted",
        "jobDeletedAt": patch.get("jobDeletedAt") or datetime.now(timezone.utc).isoformat(),
        "jobDeletedMessage": patch.get("jobDeletedMessage") or "This job was removed by the employer.",
    }
    _ensure_schema(database_url)
    pool = _ensure_pool(database_url)
    with pool.connection() as conn:
        cur = conn.execute(
            """UPDATE job_applications
               SET data = COALESCE(data, '{}'::jsonb) || %s::jsonb
               WHERE data->>'jobId' = %s""",
            (json.dumps(merged), jid),
        )
        conn.commit()
        return cur.rowcount or 0


def delete_job_application_record(database_url: str, email: str, application_id: str) -> None:
    if not database_url.strip() or not email or not application_id:
        return
    _ensure_schema(database_url)
    pool = _ensure_pool(database_url)
    with pool.connection() as conn:
        conn.execute(
            "DELETE FROM job_applications WHERE lower(email) = lower(%s) AND id = %s",
            (email, application_id),
        )
        conn.commit()


def load_job_applications_for_email(database_url: str, email: str) -> list[dict[str, Any]]:
    if not database_url.strip() or not email:
        return []
    _ensure_schema(database_url)
    pool = _ensure_pool(database_url)
    with pool.connection() as conn:
        rows = conn.execute(
            """SELECT id, data, created_at FROM job_applications
               WHERE lower(email) = lower(%s)
               ORDER BY created_at DESC""",
            (email,),
        ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        data = row["data"] if isinstance(row.get("data"), dict) else {}
        applied = data.get("appliedAt") or _iso(row.get("created_at"))
        out.append({**data, "id": str(row["id"] or data.get("id") or ""), "appliedAt": applied})
    return out


def upsert_employer_application_record(database_url: str, app: dict[str, Any]) -> None:
    if not database_url.strip() or not app.get("id"):
        return
    _ensure_schema(database_url)
    pool = _ensure_pool(database_url)
    with pool.connection() as conn:
        conn.execute(
            """INSERT INTO employer_applications
               (id, organization_id, job_id, candidate_user_id, candidate_email, status, data, applied_at)
             VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s::timestamptz)
             ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, data=EXCLUDED.data,
               candidate_user_id=EXCLUDED.candidate_user_id, candidate_email=EXCLUDED.candidate_email""",
            (
                app["id"],
                app["organizationId"],
                app["jobId"],
                app.get("candidateUserId"),
                app["candidateEmail"],
                app.get("status") or "applied",
                json.dumps(app.get("data") or {}),
                app.get("appliedAt") or datetime.now(timezone.utc).isoformat(),
            ),
        )
        conn.commit()
