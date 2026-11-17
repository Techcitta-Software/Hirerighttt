"""Indexed lookups for the request's `db`.

Every function takes the `db` the route already has. With the Postgres unit of work it runs ONE indexed query (and
remembers the rows, so a change to a returned object is saved by `runtime.save_db`). With a plain dict (unit tests,
the legacy DynamoDB mode) it falls back to scanning the in-memory lists, so behaviour is identical either way.
"""

from __future__ import annotations

from typing import Any

from app.db.uow import UnitOfWork


def _norm(email: Any) -> str:
    return str(email or "").strip().lower()


def _uow(db: Any) -> UnitOfWork | None:
    return db if isinstance(db, UnitOfWork) else None


def _tracked_first(db: UnitOfWork, name: str, pred) -> dict | None:
    for obj in db.list(name).tracked():
        if pred(obj):
            return obj
    return None


def _fetch(db: UnitOfWork, name: str, sql: str, params: tuple) -> list[dict]:
    """Run an indexed query once per request (repeat calls reuse the tracked objects)."""
    coll = db.list(name)
    if coll.is_fully_loaded():
        return []  # caller falls back to the in-memory list
    memo_key = (name, sql, repr(params))
    if memo_key in db.fetched:
        return [o for o in db.fetched[memo_key] if any(o is x for x in coll.tracked())]
    rows = coll.track_rows(db.query(sql, params))
    db.fetched[memo_key] = rows
    return rows


# --- users --------------------------------------------------------------------------------------------------------

def find_user(db: Any, *, email: Any = None, user_id: Any = None, active_only: bool = False) -> dict | None:
    em = _norm(email) if email is not None else None
    uid = str(user_id) if user_id is not None else None
    if em is None and uid is None:
        return None

    def match(u: dict) -> bool:
        if em is not None and _norm(u.get("email")) != em:
            return False
        if uid is not None and str(u.get("id")) != uid:
            return False
        if active_only and u.get("status") != "active":
            return False
        return True

    uow = _uow(db)
    if uow is None or uow.list("users").is_fully_loaded():
        return next((u for u in (db.get("users") or []) if match(u)), None)
    hit = _tracked_first(uow, "users", match)
    if hit is not None:
        return hit
    if em is not None:
        rows = _fetch(uow, "users", "SELECT * FROM users WHERE email = %s", (em,))
    else:
        rows = _fetch(uow, "users", "SELECT * FROM users WHERE id = %s", (uid,))
    return next((u for u in rows if match(u)), None)


def find_users_by_ids(db: Any, ids: list[Any]) -> list[dict]:
    wanted = [str(i) for i in ids if i]
    if not wanted:
        return []
    uow = _uow(db)
    if uow is None or uow.list("users").is_fully_loaded():
        s = set(wanted)
        return [u for u in (db.get("users") or []) if str(u.get("id")) in s]
    known = {str(u.get("id")): u for u in uow.list("users").tracked()}
    missing = [i for i in wanted if i not in known]
    if missing:
        for u in _fetch(uow, "users", "SELECT * FROM users WHERE id = ANY(%s)", (missing,)):
            known[str(u.get("id"))] = u
    return [known[i] for i in wanted if i in known]


def find_users_by_emails(db: Any, emails: list[Any]) -> dict[str, dict]:
    wanted = sorted({_norm(e) for e in emails if e})
    if not wanted:
        return {}
    uow = _uow(db)
    if uow is None or uow.list("users").is_fully_loaded():
        s = set(wanted)
        return {_norm(u.get("email")): u for u in (db.get("users") or []) if _norm(u.get("email")) in s}
    known = {_norm(u.get("email")): u for u in uow.list("users").tracked()}
    missing = [e for e in wanted if e not in known]
    if missing:
        for u in _fetch(uow, "users", "SELECT * FROM users WHERE email = ANY(%s)", (missing,)):
            known[_norm(u.get("email"))] = u
    return {e: known[e] for e in wanted if e in known}


def find_user_by_phone(db: Any, raw_phone: Any) -> dict | None:
    from app.auth_phone import find_user_by_phone as scan, normalize_phone

    norm = normalize_phone(raw_phone)
    if not norm:
        return None
    uow = _uow(db)
    if uow is None or uow.list("users").is_fully_loaded():
        return scan(list(db.get("users") or []), raw_phone)
    rows = _fetch(uow, "users", "SELECT * FROM users WHERE phone = %s", (norm,))
    return rows[0] if rows else None


def users_with_role(db: Any, role: str, limit: int = 5000) -> list[dict]:
    uow = _uow(db)
    if uow is None or uow.list("users").is_fully_loaded():
        return [u for u in (db.get("users") or []) if u.get("role") == role][:limit]
    return _fetch(uow, "users", "SELECT * FROM users WHERE role = %s ORDER BY created_at DESC LIMIT %s", (role, limit))


# --- organizations / membership / plans ---------------------------------------------------------------------------

def find_organization(db: Any, org_id: Any) -> dict | None:
    oid = str(org_id or "")
    if not oid:
        return None
    uow = _uow(db)
    if uow is None or uow.list("organizations").is_fully_loaded():
        return next((o for o in (db.get("organizations") or []) if o.get("id") == oid), None)
    hit = _tracked_first(uow, "organizations", lambda o: o.get("id") == oid)
    if hit is not None:
        return hit
    rows = _fetch(uow, "organizations", "SELECT * FROM organizations WHERE id = %s", (oid,))
    return rows[0] if rows else None


def organization_slugs_like(db: Any, slug: str) -> set[str]:
    uow = _uow(db)
    if uow is None or uow.list("organizations").is_fully_loaded():
        return {o.get("slug") for o in (db.get("organizations") or []) if o.get("slug")}
    rows = uow.query("SELECT slug FROM organizations WHERE slug = %s OR slug LIKE %s", (slug, slug + "-%"))
    taken = {r["slug"] for r in rows}
    taken |= {o.get("slug") for o in uow.list("organizations").tracked() if o.get("slug")}
    return taken


def memberships_for_user(db: Any, user_id: Any) -> list[dict]:
    uid = str(user_id or "")
    if not uid:
        return []
    uow = _uow(db)
    if uow is None or uow.list("organizationMembers").is_fully_loaded():
        return [m for m in (db.get("organizationMembers") or []) if m.get("userId") == uid]
    _fetch(uow, "organizationMembers", "SELECT * FROM organization_members WHERE user_id = %s ORDER BY joined_at ASC", (uid,))
    return [m for m in uow.list("organizationMembers").tracked() if m.get("userId") == uid]


def members_of_org(db: Any, org_id: Any) -> list[dict]:
    oid = str(org_id or "")
    if not oid:
        return []
    uow = _uow(db)
    if uow is None or uow.list("organizationMembers").is_fully_loaded():
        return [m for m in (db.get("organizationMembers") or []) if m.get("organizationId") == oid]
    _fetch(uow, "organizationMembers", "SELECT * FROM organization_members WHERE organization_id = %s ORDER BY joined_at ASC", (oid,))
    return [m for m in uow.list("organizationMembers").tracked() if m.get("organizationId") == oid]


def subscription_for_org(db: Any, org_id: Any) -> dict | None:
    oid = str(org_id or "")
    if not oid:
        return None
    uow = _uow(db)
    if uow is None or uow.list("organizationSubscriptions").is_fully_loaded():
        return next((s for s in (db.get("organizationSubscriptions") or []) if s.get("organizationId") == oid), None)
    hit = _tracked_first(uow, "organizationSubscriptions", lambda s: s.get("organizationId") == oid)
    if hit is not None:
        return hit
    rows = _fetch(uow, "organizationSubscriptions", "SELECT * FROM organization_subscriptions WHERE organization_id = %s", (oid,))
    return rows[0] if rows else None


def all_plans(db: Any) -> list[dict]:
    return list(db.get("subscriptionPlans") or [])  # a handful of rows


def find_plan(db: Any, plan_id: Any) -> dict | None:
    return next((p for p in all_plans(db) if p.get("id") == plan_id), None)


# --- jobs -----------------------------------------------------------------------------------------------------------

def find_job(db: Any, job_id: Any) -> dict | None:
    jid = str(job_id or "")
    if not jid:
        return None
    uow = _uow(db)
    if uow is None or uow.list("jobs").is_fully_loaded():
        return next((j for j in (db.get("jobs") or []) if j.get("id") == jid), None)
    hit = _tracked_first(uow, "jobs", lambda j: j.get("id") == jid)
    if hit is not None:
        return hit
    rows = _fetch(uow, "jobs", "SELECT * FROM jobs WHERE id = %s", (jid,))
    return rows[0] if rows else None


def jobs_for_org(db: Any, org_id: Any, *, include_closed: bool = True) -> list[dict]:
    oid = str(org_id or "")
    if not oid:
        return []
    uow = _uow(db)
    if uow is None or uow.list("jobs").is_fully_loaded():
        out = [j for j in (db.get("jobs") or []) if j.get("organizationId") == oid]
    else:
        _fetch(uow, "jobs", "SELECT * FROM jobs WHERE organization_id = %s ORDER BY created_at DESC", (oid,))
        out = [j for j in uow.list("jobs").tracked() if j.get("organizationId") == oid]
    if not include_closed:
        out = [j for j in out if str(j.get("status") or "published").lower() not in ("archived", "deleted")]
    return sorted(out, key=lambda j: str(j.get("createdAt") or ""), reverse=True)


def open_jobs(db: Any, limit: int = 2000) -> list[dict]:
    """Published jobs, newest first (bounded: the public job board pages through these)."""
    uow = _uow(db)
    if uow is None or uow.list("jobs").is_fully_loaded():
        out = [j for j in (db.get("jobs") or []) if str(j.get("status") or "published").lower() in ("active", "published")]
        return sorted(out, key=lambda j: str(j.get("createdAt") or ""), reverse=True)[:limit]
    rows = _fetch(
        uow, "jobs",
        """SELECT * FROM jobs WHERE COALESCE(status, 'published') IN ('active', 'published')
           ORDER BY created_at DESC LIMIT %s""",
        (limit,),
    )
    return rows


def shareable_codes_exist(db: Any, codes: list[str]) -> set[str]:
    uow = _uow(db)
    if uow is None or uow.list("jobs").is_fully_loaded():
        have = {str(j.get("shareableCode") or "") for j in (db.get("jobs") or [])}
        return {c for c in codes if c in have}
    rows = uow.query("SELECT shareable_code FROM jobs WHERE shareable_code = ANY(%s)", (list(codes),))
    return {r["shareable_code"] for r in rows}


def jobs_by_shareable_code(db: Any, code: str) -> list[dict]:
    c = str(code or "").strip().lower()
    if not c:
        return []
    uow = _uow(db)
    if uow is None or uow.list("jobs").is_fully_loaded():
        return [j for j in (db.get("jobs") or []) if str(j.get("shareableCode") or "").lower() == c]
    _fetch(uow, "jobs", "SELECT * FROM jobs WHERE LOWER(shareable_code) = %s", (c,))
    return [j for j in uow.list("jobs").tracked() if str(j.get("shareableCode") or "").lower() == c]


def remove_job(db: Any, job_id: Any) -> None:
    """Delete a job and its employer applications (on the next save)."""
    jid = str(job_id or "")
    uow = _uow(db)
    if uow is None:
        db["jobs"] = [j for j in db.get("jobs") or [] if j.get("id") != jid]
        db["employerApplications"] = [a for a in db.get("employerApplications") or [] if a.get("jobId") != jid]
        return
    job = find_job(db, jid)
    if job is not None:
        uow.list("jobs").remove_obj(job)
    for app in employer_apps_for_job(db, jid):
        uow.list("employerApplications").remove_obj(app)


# --- employer applications ----------------------------------------------------------------------------------------

def find_employer_app(db: Any, app_id: Any) -> dict | None:
    aid = str(app_id or "")
    if not aid:
        return None
    uow = _uow(db)
    if uow is None or uow.list("employerApplications").is_fully_loaded():
        return next((a for a in (db.get("employerApplications") or []) if a.get("id") == aid), None)
    hit = _tracked_first(uow, "employerApplications", lambda a: a.get("id") == aid)
    if hit is not None:
        return hit
    rows = _fetch(uow, "employerApplications", "SELECT * FROM employer_applications WHERE id = %s", (aid,))
    return rows[0] if rows else None


def employer_apps_for_job(db: Any, job_id: Any) -> list[dict]:
    jid = str(job_id or "")
    uow = _uow(db)
    if uow is None or uow.list("employerApplications").is_fully_loaded():
        return [a for a in (db.get("employerApplications") or []) if a.get("jobId") == jid]
    _fetch(uow, "employerApplications", "SELECT * FROM employer_applications WHERE job_id = %s ORDER BY applied_at DESC", (jid,))
    return [a for a in uow.list("employerApplications").tracked() if a.get("jobId") == jid]


def employer_apps_for_org(db: Any, org_id: Any) -> list[dict]:
    oid = str(org_id or "")
    uow = _uow(db)
    if uow is None or uow.list("employerApplications").is_fully_loaded():
        return [a for a in (db.get("employerApplications") or []) if a.get("organizationId") == oid]
    _fetch(uow, "employerApplications", "SELECT * FROM employer_applications WHERE organization_id = %s ORDER BY applied_at DESC", (oid,))
    return [a for a in uow.list("employerApplications").tracked() if a.get("organizationId") == oid]


def employer_apps_for_candidate(db: Any, email: Any) -> list[dict]:
    em = _norm(email)
    uow = _uow(db)
    if uow is None or uow.list("employerApplications").is_fully_loaded():
        return [a for a in (db.get("employerApplications") or []) if _norm(a.get("candidateEmail")) == em]
    _fetch(uow, "employerApplications", "SELECT * FROM employer_applications WHERE candidate_email = %s ORDER BY applied_at DESC", (em,))
    return [a for a in uow.list("employerApplications").tracked() if _norm(a.get("candidateEmail")) == em]


def find_employer_app_for(db: Any, job_id: Any, email: Any) -> dict | None:
    em = _norm(email)
    return next((a for a in employer_apps_for_job(db, job_id) if _norm(a.get("candidateEmail")) == em), None)


# --- confidential vault -------------------------------------------------------------------------------------------

def vault_for_org(db: Any, org_id: Any) -> list[dict]:
    oid = str(org_id or "")
    uow = _uow(db)
    if uow is None or uow.list("confidentialVault").is_fully_loaded():
        return [c for c in (db.get("confidentialVault") or []) if c.get("organizationId") == oid]
    _fetch(
        uow, "confidentialVault",
        "SELECT * FROM confidential_candidates WHERE organization_id = %s ORDER BY sort_order ASC, created_at DESC", (oid,),
    )
    return [c for c in uow.list("confidentialVault").tracked() if c.get("organizationId") == oid]


def remove_vault_item(db: Any, item: dict) -> None:
    uow = _uow(db)
    if uow is None:
        db["confidentialVault"] = [c for c in db.get("confidentialVault") or [] if c is not item]
        return
    uow.list("confidentialVault").remove_obj(item)


# --- interview sessions / profiles --------------------------------------------------------------------------------

def sessions_for_email(db: Any, email: Any) -> list[dict]:
    em = _norm(email)
    sessions = db.get("interviewSessions") or {}
    uow = _uow(db)
    if uow is None:
        return [s for s in sessions.values() if isinstance(s, dict) and _norm(s.get("email")) == em]
    table = uow.keyed("interviewSessions")
    for r in uow.query("SELECT session_id, data FROM interview_sessions WHERE email = %s ORDER BY updated_at ASC", (em,)):
        table.prime(r["session_id"], r["data"])
    return [s for s in table._values.values() if isinstance(s, dict) and _norm(s.get("email")) == em]


def session_items_for_email(db: Any, email: Any) -> list[tuple[str, dict]]:
    """(session_id, session) pairs for one candidate."""
    em = _norm(email)
    sessions = db.get("interviewSessions") or {}
    uow = _uow(db)
    if uow is None:
        return [(sid, s) for sid, s in list(sessions.items()) if isinstance(s, dict) and _norm(s.get("email")) == em]
    table = uow.keyed("interviewSessions")
    rows = uow.query("SELECT session_id, data FROM interview_sessions WHERE email = %s ORDER BY updated_at ASC", (em,))
    return [(r["session_id"], table.prime(r["session_id"], r["data"])) for r in rows]


def sessions_for_invite(db: Any, invite_token: str) -> list[dict]:
    sessions = db.get("interviewSessions") or {}
    uow = _uow(db)
    if uow is None:
        return [s for s in sessions.values() if isinstance(s, dict) and s.get("inviteToken") == invite_token]
    table = uow.keyed("interviewSessions")
    rows = uow.query("SELECT session_id, data FROM interview_sessions WHERE data->>'inviteToken' = %s", (invite_token,))
    return [table.prime(r["session_id"], r["data"]) for r in rows]


def applications_for_job(db: Any, job_id: str) -> dict[str, list]:
    """Candidates' own application lists that contain this job: {email: [application, ...]} (tracked for saving)."""
    jid = str(job_id or "")
    apps = db.get("applications") or {}
    uow = _uow(db)
    if uow is None:
        return {e: rows for e, rows in apps.items() if isinstance(rows, list) and any(str(r.get("jobId") or "") == jid for r in rows)}
    rows = uow.query("SELECT DISTINCT email FROM job_applications WHERE data->>'jobId' = %s", (jid,))
    table = uow.keyed("applications")
    return {r["email"]: table[r["email"]] for r in rows if r["email"] in table}


def sessions_for_org(db: Any, org_id: Any, limit: int = 2000) -> list[dict]:
    oid = str(org_id or "")
    sessions = db.get("interviewSessions") or {}
    uow = _uow(db)
    if uow is None:
        return [s for s in sessions.values() if isinstance(s, dict) and str(s.get("organizationId") or "") == oid]
    table = uow.keyed("interviewSessions")
    rows = uow.query(
        "SELECT session_id, data FROM interview_sessions WHERE organization_id = %s ORDER BY updated_at DESC LIMIT %s",
        (oid, limit),
    )
    return [table.prime(r["session_id"], r["data"]) for r in rows]


def recruiter_member_user_ids(db: Any, user_ids: list[Any]) -> set[str]:
    """Which of these users belong to an organization's hiring team (owner / admin / recruiter)."""
    wanted = [str(i) for i in user_ids if i]
    if not wanted:
        return set()
    uow = _uow(db)
    if uow is None or uow.list("organizationMembers").is_fully_loaded():
        s = set(wanted)
        return {
            str(m.get("userId")) for m in (db.get("organizationMembers") or [])
            if str(m.get("userId")) in s and str(m.get("role") or "") in ("owner", "admin", "recruiter")
        }
    rows = uow.query(
        "SELECT DISTINCT user_id FROM organization_members WHERE user_id = ANY(%s) AND role IN ('owner', 'admin', 'recruiter')",
        (wanted,),
    )
    return {str(r["user_id"]) for r in rows}


def profiles_for_emails(db: Any, emails: list[Any]) -> dict[str, dict]:
    wanted = sorted({_norm(e) for e in emails if e})
    profiles = db.get("profiles") or {}
    uow = _uow(db)
    if uow is None or not wanted:
        return {e: profiles.get(e) for e in wanted if profiles.get(e) is not None}
    table = uow.keyed("profiles")
    missing = [e for e in wanted if e not in table._values and e not in table._missing]
    if missing:
        for r in uow.query("SELECT email, data FROM profiles WHERE email = ANY(%s)", (missing,)):
            table.prime(r["email"], r["data"])
        for e in missing:
            if e not in table._values:
                table._missing.add(e)
    return {e: table._values[e] for e in wanted if e in table._values}


def interviews_for_emails(db: Any, emails: list[Any]) -> dict[str, dict]:
    wanted = sorted({_norm(e) for e in emails if e})
    interviews = db.get("interviews") or {}
    uow = _uow(db)
    if uow is None or not wanted:
        return {e: interviews.get(e) for e in wanted if interviews.get(e) is not None}
    table = uow.keyed("interviews")
    missing = [e for e in wanted if e not in table._values and e not in table._missing]
    if missing:
        for r in uow.query("SELECT email, data FROM interview_results WHERE email = ANY(%s)", (missing,)):
            table.prime(r["email"], r["data"])
        for e in missing:
            if e not in table._values:
                table._missing.add(e)
    return {e: table._values[e] for e in wanted if e in table._values}
