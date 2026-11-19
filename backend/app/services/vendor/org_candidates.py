from __future__ import annotations

import asyncio
import threading
import time
from typing import Any

from app.db.finders import (
    employer_apps_for_org,
    find_employer_app,
    find_job,
    find_user,
    find_users_by_emails,
    find_users_by_ids,
    interviews_for_emails,
    profiles_for_emails,
    recruiter_member_user_ids,
    sessions_for_org,
    vault_for_org,
)
from app.db.store import db_pool, read_cache_epoch
from app.db.talent_index import search_candidate_talent
from app.services.vendor.jobs import list_job_applications, list_org_jobs


def _status_from_app(app: dict) -> str:
    st = str(app.get("status") or "applied").lower()
    if st == "interviewed":
        return "In Review"
    if st == "shortlisted":
        return "Shortlisted"
    if st == "rejected":
        return "Rejected"
    return "New"


def _stored_interview_for_email(db: dict, email: str) -> dict | None:
    key = str(email or "").strip().lower()
    if not key:
        return None
    interviews = db.get("interviews") or {}
    return interviews.get(key) or interviews.get(email)


def _with_stored_interview(db: dict, row: dict) -> dict:
    existing = row.get("interviewResult")
    if existing and (isinstance(existing.get("overall"), (int, float)) or existing.get("scorecard")):
        return row
    stored = _stored_interview_for_email(db, row.get("candidateEmail") or "")
    if not stored:
        return row
    out = {**row, "interviewResult": stored}
    if row.get("status") == "New":
        out["status"] = "In Review"
    return out


def _record_from_application(app: dict) -> dict:
    data = app.get("data") or {}
    return {
        "id": app.get("id"),
        "source": "application",
        "organizationId": app.get("organizationId"),
        "jobId": app.get("jobId"),
        "candidateUserId": app.get("candidateUserId"),
        "candidateEmail": str(app.get("candidateEmail") or "").lower(),
        "candidateName": data.get("candidateName") or app.get("candidateEmail"),
        "candidatePhone": data.get("candidatePhone") or "",
        "candidateRole": data.get("roleTrack") or data.get("jobTitle") or "",
        "experienceYears": data.get("experienceYears") or "",
        "jobTitle": data.get("jobTitle") or "",
        "company": data.get("company") or "",
        "resumeName": data.get("resumeName"),
        "resumeText": data.get("resumeText") or "",
        "interviewResult": data.get("interviewResult"),
        "atsScore": data.get("atsScore"),
        "jdMatchScore": data.get("jdMatchScore"),
        "primarySkills": data.get("primarySkills") or [],
        "appliedAt": app.get("appliedAt"),
        "status": _status_from_app(app),
    }


def _record_from_profile(db: dict, user: dict, profile: dict, interview: dict | None, access_type: str = "talent") -> dict:
    email = str(user.get("email") or "").lower()
    return {
        "id": f"talent-{user.get('id')}",
        "source": access_type,
        "organizationId": None,
        "jobId": None,
        "candidateUserId": user.get("id"),
        "candidateEmail": email,
        "candidateName": str(profile.get("fullName") or profile.get("name") or user.get("name") or email).strip(),
        "candidatePhone": profile.get("phone") or user.get("phone") or "",
        "candidateRole": str(profile.get("currentRole") or profile.get("whoAreYou") or "").strip(),
        "experienceYears": str(profile.get("totalExperience") or profile.get("experienceYears") or "").strip(),
        "jobTitle": "",
        "company": "",
        "resumeName": profile.get("resumeName"),
        "resumeText": str(profile.get("resumeText") or profile.get("experienceSummary") or "")[:50000],
        "interviewResult": interview,
        "atsScore": None,
        "jdMatchScore": None,
        "primarySkills": profile.get("skills") if isinstance(profile.get("skills"), list) else [],
        "appliedAt": profile.get("updatedAt") or user.get("createdAt") or "",
        "status": "In Review" if interview else "New",
    }


_LOOKUP = object()


def _record_from_talent_hit(db: dict, hit: dict, user: Any = _LOOKUP) -> dict:
    email = str(hit.get("email") or "").lower()
    if user is _LOOKUP:
        user = find_user(db, email=email) or (find_user(db, user_id=hit.get("userId")) if hit.get("userId") else None)
    profile = (db.get("profiles") or {}).get(user.get("email") if user else email) or {}
    interview = (db.get("interviews") or {}).get(email) if user else None
    if not interview and isinstance(hit.get("interviewScore"), (int, float)):
        interview = {
            "overall": hit["interviewScore"],
            "role": hit.get("currentRole") or "Interview",
            "date": hit.get("updatedAt") or "",
        }
    return {
        "id": f"talent-{hit.get('userId')}",
        "source": "talent",
        "organizationId": None,
        "jobId": None,
        "candidateUserId": hit.get("userId"),
        "candidateEmail": email,
        "candidateName": str(hit.get("fullName") or email).strip(),
        "candidatePhone": profile.get("phone") or (user.get("phone") if user else "") or "",
        "candidateRole": str(hit.get("currentRole") or "").strip(),
        "experienceYears": str(hit.get("experienceYears") or "").strip(),
        "jobTitle": str(hit.get("currentRole") or "").strip(),
        "company": "",
        "resumeName": profile.get("resumeName"),
        "resumeText": str(hit.get("resumePreview") or hit.get("summary") or profile.get("resumeText") or "")[:50000],
        "interviewResult": interview,
        "atsScore": None,
        "jdMatchScore": None,
        "primarySkills": hit.get("skills") or [],
        "appliedAt": hit.get("updatedAt") or "",
        "status": "In Review" if interview else "New",
    }


def _record_from_postgres_job_seeker_row(db: dict, row: dict) -> dict:
    email = str(row.get("email") or "").lower()
    profile_data = row.get("profile_data") if isinstance(row.get("profile_data"), dict) else {}
    profile = profile_data or (db.get("profiles") or {}).get(email) or {}
    interview_data = row.get("interview_data") if isinstance(row.get("interview_data"), dict) else None
    interview = interview_data or (db.get("interviews") or {}).get(email)
    user = {
        "id": row["id"],
        "email": row["email"],
        "name": row.get("name"),
        "role": row.get("role") or "jobseeker",
        "phone": row.get("phone"),
        "createdAt": row.get("created_at"),
    }
    return _with_stored_interview(db, _record_from_profile(db, user, profile, interview, "platform"))


def _recruiter_account_keys(db: dict, rows: list[dict]) -> set[str]:
    """Emails / user ids among `rows` that belong to employer or hiring-team accounts (never listed as candidates).

    Looks up only the accounts in `rows` (a few indexed queries), instead of indexing every user on the platform."""
    emails = {str(r.get("candidateEmail") or "").strip().lower() for r in rows if r.get("candidateEmail")}
    users = list(find_users_by_emails(db, list(emails)).values())
    ids = {str(r.get("candidateUserId")) for r in rows if r.get("candidateUserId")}
    known_ids = {str(u.get("id")) for u in users}
    users += find_users_by_ids(db, [i for i in ids if i not in known_ids])
    flagged: set[str] = set()
    team_ids = recruiter_member_user_ids(db, [u.get("id") for u in users])
    for u in users:
        if u.get("role") == "employer" or str(u.get("id")) in team_ids:
            flagged.add(str(u.get("email") or "").lower())
            flagged.add(str(u.get("id")))
    return flagged


def _is_flagged(row: dict, flagged: set[str]) -> bool:
    em = str(row.get("candidateEmail") or "").strip().lower()
    if not em:
        return True
    return em in flagged or str(row.get("candidateUserId") or "") in flagged


def _merge_records(a: dict, b: dict) -> dict:
    def pick(x: Any, y: Any) -> Any:
        return x if x and str(x).strip() else y

    source = a.get("source")
    if source != "application" and b.get("source") == "application":
        source = "application"
    row_id = a.get("id") if a.get("source") == "application" else b.get("id") if b.get("source") == "application" else a.get("id")
    skills_a = a.get("primarySkills") or []
    skills_b = b.get("primarySkills") or []
    return {
        **a,
        **b,
        "id": row_id,
        "source": source,
        "candidateName": pick(a.get("candidateName"), b.get("candidateName")),
        "resumeText": pick(a.get("resumeText"), b.get("resumeText")),
        "resumeName": pick(a.get("resumeName"), b.get("resumeName")),
        "interviewResult": a.get("interviewResult") or b.get("interviewResult"),
        "jobId": a.get("jobId") or b.get("jobId"),
        "jobTitle": pick(a.get("jobTitle"), b.get("jobTitle")),
        "primarySkills": skills_a if skills_a else skills_b,
        "atsScore": a.get("atsScore") if a.get("atsScore") is not None else b.get("atsScore"),
        "jdMatchScore": a.get("jdMatchScore") if a.get("jdMatchScore") is not None else b.get("jdMatchScore"),
    }


def _matches_filters(row: dict, filters: dict) -> bool:
    name_q = str(filters.get("name") or "").strip().lower()
    job_q = str(filters.get("job") or "").strip().lower()
    exp_q = str(filters.get("experienceYears") or filters.get("experience") or "").strip().lower()
    kw_q = str(filters.get("keywords") or filters.get("q") or "").strip().lower()

    if name_q:
        blob = f"{row.get('candidateName') or ''} {row.get('candidateEmail') or ''}".lower()
        if name_q not in blob:
            return False
    if job_q:
        blob = f"{row.get('jobTitle') or ''} {row.get('company') or ''} {row.get('candidateRole') or ''}".lower()
        if job_q not in blob:
            return False
    if exp_q and exp_q not in str(row.get("experienceYears") or "").lower():
        return False
    if kw_q:
        ir = row.get("interviewResult") or {}
        hay = " ".join(
            [
                str(row.get("candidateRole") or ""),
                str(row.get("candidateName") or ""),
                str(row.get("jobTitle") or ""),
                " ".join(row.get("primarySkills") or []),
                str(row.get("resumeText") or "")[:2000],
                str(ir.get("role") or ""),
                " ".join(ir.get("strengths") or []),
                " ".join(ir.get("improvements") or []),
            ]
        ).lower()
        if kw_q not in hay:
            return False
    if filters.get("jobId") and row.get("jobId") != filters.get("jobId"):
        return False
    return True


ROSTER_LIMIT = 200  # newest job seekers listed without a search; searching reaches everyone (talent index)


def _load_all_job_seeker_roster_from_postgres(database_url: str, db: dict, filters: dict | None = None) -> list[dict]:
    filters = filters or {}
    if not database_url.strip():
        return [
            _with_stored_interview(
                db,
                _record_from_profile(
                    db,
                    user,
                    (db.get("profiles") or {}).get(user.get("email") or "") or {},
                    (db.get("interviews") or {}).get(user.get("email") or ""),
                    "platform",
                ),
            )
            for user in db.get("users") or []
            if user.get("role") != "employer"
        ]
    try:
        pool = db_pool(database_url)
        with pool.connection() as conn:
            rows = conn.execute(
                """SELECT
                     u.id,
                     u.email,
                     u.name,
                     u.role,
                     u.phone,
                     u.created_at,
                     p.data AS profile_data,
                     ir.data AS interview_data
                   FROM users u
                   LEFT JOIN profiles p ON lower(p.email) = lower(u.email)
                   LEFT JOIN interview_results ir ON lower(ir.email) = lower(u.email)
                   WHERE LOWER(COALESCE(u.role, 'jobseeker')) = 'jobseeker'
                     AND NOT EXISTS (
                       SELECT 1 FROM organization_members om
                       WHERE om.user_id = u.id
                         AND om.role IN ('owner', 'admin', 'recruiter')
                     )
                     AND (%(name)s = '' OR u.name ILIKE %(name_like)s OR u.email ILIKE %(name_like)s)
                   ORDER BY u.created_at DESC
                   LIMIT %(limit)s""",
                {
                    "name": str(filters.get("name") or "").strip(),
                    "name_like": "%" + str(filters.get("name") or "").strip() + "%",
                    "limit": ROSTER_LIMIT,
                },
            ).fetchall()
        rows = [dict(r) for r in rows]
        # One query for the rows without a joined interview (each used to be its own SELECT).
        interviews_for_emails(db, [r.get("email") for r in rows if not isinstance(r.get("interview_data"), dict)])
        return [_record_from_postgres_job_seeker_row(db, r) for r in rows]
    except Exception:
        return [
            _with_stored_interview(
                db,
                _record_from_profile(
                    db,
                    user,
                    (db.get("profiles") or {}).get(user.get("email") or "") or {},
                    (db.get("interviews") or {}).get(user.get("email") or ""),
                    "platform",
                ),
            )
            for user in db.get("users") or []
            if user.get("role") != "employer"
        ]


def _list_organization_talent_user_ids(database_url: str, organization_id: str) -> list[str]:
    if not database_url.strip() or not organization_id:
        return []
    try:
        pool = db_pool(database_url)
        with pool.connection() as conn:
            rows = conn.execute(
                "SELECT user_id FROM organization_talent_access WHERE organization_id = %s",
                (organization_id,),
            ).fetchall()
        return [str(r["user_id"]) for r in rows]
    except Exception:
        return []


async def _merge_talent_search(database_url: str, organization_id: str, filters: dict, db: dict, add) -> None:
    search_q = " ".join(
        [str(filters.get("keywords") or ""), str(filters.get("name") or ""), str(filters.get("q") or "")]
    ).strip()
    try:
        talent = await search_candidate_talent(
            database_url,
            organization_id,
            {
                "q": search_q,
                "experienceYears": filters.get("experienceYears") or filters.get("experience") or "",
                "limit": 250,
                "offset": 0,
            },
        )
        hits = [h for h in talent.get("candidates") or [] if isinstance(h, dict)]
        # Batch the per-hit lookups (user by email, then by id; profile; stored interview): a handful of
        # ANY(...) queries instead of 3-4 SELECTs per hit (36-250 hits).
        emails = [str(h.get("email") or "").lower() for h in hits if h.get("email")]
        by_email = find_users_by_emails(db, emails)
        by_id = {
            str(u.get("id")): u
            for u in find_users_by_ids(
                db, [h.get("userId") for h in hits if h.get("userId") and str(h.get("email") or "").lower() not in by_email]
            )
        }
        profiles_for_emails(db, emails + [u.get("email") for u in by_id.values()])
        interviews_for_emails(db, emails)
        for hit in hits:
            email = str(hit.get("email") or "").lower()
            user = by_email.get(email) or (by_id.get(str(hit.get("userId"))) if hit.get("userId") else None)
            add(_with_stored_interview(db, _record_from_talent_hit(db, hit, user)))
    except Exception:
        pass


LIST_RESUME_TEXT_CHARS = 4000  # list rows in the "org" view carry a preview; full text via the resume endpoints


def _cap_resume_text(row: dict, limit: int) -> dict:
    full = str(row.get("resumeText") or "")
    if len(full) <= limit:
        return row
    return {**row, "resumeText": full[:limit], "resumeTextTruncated": True, "resumeTextLength": len(full)}


def list_job_candidates(db: dict, organization_id: str, job_id: str, filters: dict | None = None) -> dict[str, Any]:
    filters = filters or {}
    rows = [_record_from_application(a) for a in list_job_applications(db, organization_id, job_id)]
    flagged = _recruiter_account_keys(db, rows)
    interviews_for_emails(db, [r.get("candidateEmail") for r in rows])
    candidates = [_with_stored_interview(db, r) for r in rows if not _is_flagged(r, flagged)]
    by_email: dict[str, dict] = {}
    for row in candidates:
        key = str(row.get("candidateEmail") or "").lower()
        prev = by_email.get(key)
        by_email[key] = _merge_records(prev, row) if prev else row
    filtered = [r for r in by_email.values() if _matches_filters(r, {**filters, "jobId": job_id})]
    return {"total": len(filtered), "candidates": filtered, "jobId": job_id}


# The "every job seeker on the platform" roster is the same for all recruiters and used to be re-read from Postgres
# (profiles + interview JSON for ALL users) on every request, inside the event loop. Share it for a few seconds.
_SEEKER_ROSTER_TTL_S = 8.0
_seeker_roster_lock = threading.Lock()
_seeker_roster: dict[str, Any] = {"at": -1e9, "epoch": -1, "rows": []}


def _all_job_seeker_roster_cached(database_url: str, db: dict, filters: dict | None = None) -> list[dict]:
    """Blocking (runs in a worker thread). One thread refreshes; concurrent callers reuse the result."""
    if str((filters or {}).get("name") or "").strip():
        return _load_all_job_seeker_roster_from_postgres(database_url, db, filters)

    def fresh() -> bool:
        return (
            time.monotonic() - _seeker_roster["at"] < _SEEKER_ROSTER_TTL_S
            and _seeker_roster["epoch"] == read_cache_epoch()
        )

    if not fresh():
        with _seeker_roster_lock:
            if not fresh():
                epoch = read_cache_epoch()
                rows = _load_all_job_seeker_roster_from_postgres(database_url, db)
                _seeker_roster.update(at=time.monotonic(), epoch=epoch, rows=rows)
    return [dict(r) for r in _seeker_roster["rows"]]


async def list_organization_candidates(
    db: dict,
    organization_id: str,
    database_url: str,
    filters: dict | None = None,
    recruiter_scope: dict | None = None,
) -> dict[str, Any]:
    filters = filters or {}
    # scope="org": only the organisation's own candidates (applications, shared interviews, vault, interview
    # reports) - the platform-wide roster and talent search (sources "platform" / "talent") are skipped entirely.
    org_only = str(filters.get("scope") or "").strip().lower() == "org"
    recruiter_job_ids = None
    if recruiter_scope and recruiter_scope.get("createdByUserId"):
        recruiter_job_ids = {j["id"] for j in list_org_jobs(db, organization_id, recruiter_scope)}

    by_key: dict[str, dict] = {}

    def add(row: dict | None) -> None:
        if not row or not row.get("candidateEmail"):
            return
        key = str(row.get("candidateUserId") or row.get("candidateEmail") or "").lower()
        prev = by_key.get(key)
        by_key[key] = _merge_records(prev, row) if prev else row

    org_apps = employer_apps_for_org(db, organization_id)
    interviews_for_emails(db, [a.get("candidateEmail") for a in org_apps])  # one query for all of them
    for app in org_apps:
        if recruiter_job_ids and app.get("jobId") not in recruiter_job_ids:
            continue
        add(_with_stored_interview(db, _record_from_application(app)))

    for vault in vault_for_org(db, organization_id):
        add(
            {
                "id": vault.get("id"),
                "source": "vault",
                "organizationId": organization_id,
                "jobId": None,
                "candidateUserId": None,
                "candidateEmail": str(vault.get("email") or "").lower(),
                "candidateName": vault.get("name"),
                "candidatePhone": vault.get("phone") or "",
                "candidateRole": vault.get("currentRole") or "",
                "experienceYears": vault.get("experienceYears") or "",
                "jobTitle": vault.get("currentRole") or "",
                "company": "",
                "resumeName": vault.get("resumeName"),
                "resumeText": vault.get("resumeText") or "",
                "interviewResult": vault.get("interviewResult"),
                "primarySkills": vault.get("skills") or [],
                "appliedAt": vault.get("createdAt"),
                "status": vault.get("status") or "New",
            }
        )

    if database_url.strip():
        talent_user_ids = await asyncio.to_thread(_list_organization_talent_user_ids, database_url, organization_id)
        talent_users = find_users_by_ids(db, talent_user_ids)
        profiles_for_emails(db, [u.get("email") for u in talent_users])
        interviews_for_emails(db, [u.get("email") for u in talent_users])
        for user in talent_users:
            if not user or user.get("role") == "employer":
                continue
            profile = (db.get("profiles") or {}).get(user.get("email") or "") or {}
            interview = (db.get("interviews") or {}).get(user.get("email") or "")
            add(_with_stored_interview(db, _record_from_profile(db, user, profile, interview, "interview")))

    org_sessions = sessions_for_org(db, organization_id)
    session_emails = [s.get("email") for s in org_sessions]
    find_users_by_emails(db, session_emails)
    profiles_for_emails(db, session_emails)
    interviews_for_emails(db, session_emails)
    for session in org_sessions:
        email = str(session.get("email") or "").lower()
        if not email:
            continue
        result = session.get("result") or _stored_interview_for_email(db, email)
        if not result:
            continue
        user = find_user(db, email=email)
        profile = (db.get("profiles") or {}).get(email) or {}
        app = None
        app_id = session.get("applicationId")
        if app_id:
            app = find_employer_app(db, app_id)
        data = (app or {}).get("data") or {}
        job_id = session.get("jobId") or (app or {}).get("jobId")
        job = find_job(db, job_id) if job_id else None
        add(
            _with_stored_interview(
                db,
                {
                    "id": app_id or f"report-{user.get('id') if user else email}",
                    "source": "application" if app else "interview_report",
                    "organizationId": organization_id,
                    "jobId": job_id,
                    "candidateUserId": user.get("id") if user else None,
                    "candidateEmail": email,
                    "candidateName": str(
                        data.get("candidateName")
                        or profile.get("fullName")
                        or (user.get("name") if user else email)
                    ).strip(),
                    "candidatePhone": data.get("candidatePhone") or profile.get("phone") or "",
                    "candidateRole": str(data.get("roleTrack") or profile.get("currentRole") or (job or {}).get("roleTrack") or "").strip(),
                    "experienceYears": str(data.get("experienceYears") or profile.get("totalExperience") or "").strip(),
                    "jobTitle": data.get("jobTitle") or (job or {}).get("title") or "",
                    "company": data.get("company") or (job or {}).get("company") or "",
                    "resumeName": data.get("resumeName") or profile.get("resumeName"),
                    "resumeText": str(data.get("resumeText") or profile.get("resumeText") or "")[:50000],
                    "interviewResult": result,
                    "primarySkills": data.get("primarySkills") or (job or {}).get("requiredSkills") or [],
                    "appliedAt": (app or {}).get("appliedAt") or session.get("completedAt") or session.get("startedAt"),
                    "status": "In Review",
                },
            )
        )

    if not org_only:
        for row in await asyncio.to_thread(_all_job_seeker_roster_cached, database_url, db, filters):
            add(row)

        if database_url.strip():
            await _merge_talent_search(database_url, organization_id, filters, db, add)

    rows = list(by_key.values())
    flagged = await asyncio.to_thread(_recruiter_account_keys, db, rows)
    interviews_for_emails(db, [r.get("candidateEmail") for r in rows])
    candidates = [_with_stored_interview(db, row) for row in rows]
    candidates = [
        row
        for row in candidates
        if not _is_flagged(row, flagged)
        and (not recruiter_job_ids or not row.get("jobId") or row.get("jobId") in recruiter_job_ids)
        and _matches_filters(row, filters)
    ]
    candidates.sort(key=lambda r: str(r.get("appliedAt") or ""), reverse=True)
    if org_only:
        candidates = [_cap_resume_text(r, LIST_RESUME_TEXT_CHARS) for r in candidates]
    return {"total": len(candidates), "candidates": candidates}
