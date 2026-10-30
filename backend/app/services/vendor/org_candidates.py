from __future__ import annotations

from typing import Any

from app.db.store import db_pool
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


def _record_from_talent_hit(db: dict, hit: dict) -> dict:
    email = str(hit.get("email") or "").lower()
    user = next(
        (u for u in db.get("users") or [] if u.get("email") == email or u.get("id") == hit.get("userId")),
        None,
    )
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


def _build_recruiter_team_email_set(db: dict) -> set[str]:
    emails: set[str] = set()
    for member in db.get("organizationMembers") or []:
        if str(member.get("role") or "") not in ("owner", "admin", "recruiter"):
            continue
        user = next((u for u in db.get("users") or [] if u.get("id") == member.get("userId")), None)
        if user and user.get("email"):
            emails.add(str(user["email"]).lower())
    for user in db.get("users") or []:
        if user.get("role") == "employer" and user.get("email"):
            emails.add(str(user["email"]).lower())
    return emails


def _find_user(db: dict, email: str, user_id: str | None) -> dict | None:
    if user_id:
        user = next((u for u in db.get("users") or [] if u.get("id") == user_id), None)
        if user:
            return user
    em = str(email or "").strip().lower()
    if not em:
        return None
    return next((u for u in db.get("users") or [] if str(u.get("email") or "").lower() == em), None)


def _is_employer_or_recruiter_account(db: dict, email: str, user_id: str | None, recruiter_emails: set[str]) -> bool:
    em = str(email or "").strip().lower()
    if not em:
        return True
    if em in recruiter_emails:
        return True
    user = _find_user(db, email, user_id)
    if not user:
        return False
    if user.get("role") == "employer":
        return True
    if user.get("primaryOrganizationId"):
        membership = next((m for m in db.get("organizationMembers") or [] if m.get("userId") == user.get("id")), None)
        if membership and str(membership.get("role") or "") in ("owner", "admin", "recruiter"):
            return True
    return False


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


def _load_all_job_seeker_roster_from_postgres(database_url: str, db: dict) -> list[dict]:
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
                   ORDER BY u.created_at DESC"""
            ).fetchall()
        return [_record_from_postgres_job_seeker_row(db, dict(r)) for r in rows]
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
        for hit in talent.get("candidates") or []:
            add(_with_stored_interview(db, _record_from_talent_hit(db, hit)))
    except Exception:
        pass


def list_job_candidates(db: dict, organization_id: str, job_id: str, filters: dict | None = None) -> dict[str, Any]:
    filters = filters or {}
    recruiter_emails = _build_recruiter_team_email_set(db)
    apps = [
        a
        for a in list_job_applications(db, organization_id, job_id)
        if not _is_employer_or_recruiter_account(db, a.get("candidateEmail"), a.get("candidateUserId"), recruiter_emails)
    ]
    candidates = [_with_stored_interview(db, _record_from_application(a)) for a in apps]
    by_email: dict[str, dict] = {}
    for row in candidates:
        key = str(row.get("candidateEmail") or "").lower()
        prev = by_email.get(key)
        by_email[key] = _merge_records(prev, row) if prev else row
    filtered = [r for r in by_email.values() if _matches_filters(r, {**filters, "jobId": job_id})]
    return {"total": len(filtered), "candidates": filtered, "jobId": job_id}


async def list_organization_candidates(
    db: dict,
    organization_id: str,
    database_url: str,
    filters: dict | None = None,
    recruiter_scope: dict | None = None,
) -> dict[str, Any]:
    filters = filters or {}
    recruiter_emails = _build_recruiter_team_email_set(db)
    recruiter_job_ids = None
    if recruiter_scope and recruiter_scope.get("createdByUserId"):
        recruiter_job_ids = {j["id"] for j in list_org_jobs(db, organization_id, recruiter_scope)}

    by_key: dict[str, dict] = {}

    def add(row: dict | None) -> None:
        if not row or not row.get("candidateEmail"):
            return
        if _is_employer_or_recruiter_account(
            db, row.get("candidateEmail"), row.get("candidateUserId"), recruiter_emails
        ):
            return
        key = str(row.get("candidateUserId") or row.get("candidateEmail") or "").lower()
        prev = by_key.get(key)
        by_key[key] = _merge_records(prev, row) if prev else row

    for app in db.get("employerApplications") or []:
        if app.get("organizationId") != organization_id:
            continue
        if recruiter_job_ids and app.get("jobId") not in recruiter_job_ids:
            continue
        add(_with_stored_interview(db, _record_from_application(app)))

    for vault in db.get("confidentialVault") or []:
        if vault.get("organizationId") != organization_id:
            continue
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
        for user_id in _list_organization_talent_user_ids(database_url, organization_id):
            user = next((u for u in db.get("users") or [] if u.get("id") == user_id), None)
            if not user or user.get("role") == "employer":
                continue
            profile = (db.get("profiles") or {}).get(user.get("email") or "") or {}
            interview = (db.get("interviews") or {}).get(user.get("email") or "")
            add(_with_stored_interview(db, _record_from_profile(db, user, profile, interview, "interview")))

    for session in (db.get("interviewSessions") or {}).values():
        if str(session.get("organizationId") or "") != str(organization_id):
            continue
        email = str(session.get("email") or "").lower()
        if not email:
            continue
        result = session.get("result") or _stored_interview_for_email(db, email)
        if not result:
            continue
        user = _find_user(db, email, None)
        profile = (db.get("profiles") or {}).get(email) or {}
        app = None
        app_id = session.get("applicationId")
        if app_id:
            app = next((a for a in db.get("employerApplications") or [] if a.get("id") == app_id), None)
        data = (app or {}).get("data") or {}
        job_id = session.get("jobId") or (app or {}).get("jobId")
        job = next((j for j in db.get("jobs") or [] if j.get("id") == job_id), None) if job_id else None
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

    for row in _load_all_job_seeker_roster_from_postgres(database_url, db):
        add(row)

    if database_url.strip():
        await _merge_talent_search(database_url, organization_id, filters, db, add)

    candidates = [_with_stored_interview(db, row) for row in by_key.values()]
    candidates = [
        row
        for row in candidates
        if not _is_employer_or_recruiter_account(db, row.get("candidateEmail"), row.get("candidateUserId"), recruiter_emails)
        and (not recruiter_job_ids or not row.get("jobId") or row.get("jobId") in recruiter_job_ids)
        and _matches_filters(row, filters)
    ]
    candidates.sort(key=lambda r: str(r.get("appliedAt") or ""), reverse=True)
    return {"total": len(candidates), "candidates": candidates}
