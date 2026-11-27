"""The employer "Candidates" page: every job seeker on HireRighttt who is visible to employers, one row per person.

GET /api/vendor/candidates?scope=platform  (search, filters and pagination run on the server).

Privacy:
- Only job seekers whose profile is visible to employers (profileVisibility "marketplace", the default) are listed.
  A candidate who hid their profile ("private" / "organization_only") is still listed for an organisation they are
  linked to (applied to its job, interviewed with it, or granted it access), because they shared their profile there.
- OWNER DECISION (reverses the earlier V-05 restriction): every listed row carries the candidate's e-mail, phone,
  resume and full interview report, for any employer.
- Hiring-team accounts (employers, org owners / admins / recruiters) are never listed.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any

from app.db.finders import (
    employer_apps_for_org,
    find_users_by_ids,
    interviews_for_emails,
    profiles_for_emails,
    recruiter_member_user_ids,
    sessions_for_org,
)
from app.db.store import db_pool
from app.services.vendor.candidate_documents import (
    LINKED_ROSTER_SOURCES,
    candidate_shares_contact,
    redact_roster_rows,
)
from app.services.vendor.jobs import list_org_jobs
from app.services.vendor.org_candidates import (
    _list_organization_talent_user_ids,
    _merge_records,
    _record_from_application,
    _record_from_profile,
    _vendor_roster_sql_params,
    _with_stored_interview,
    vendor_directory_profile_ok,
    vendor_roster_profile_sql,
)

PAGE_SIZE_DEFAULT = 20
PAGE_SIZE_MAX = 50
HIDDEN_VISIBILITY = ("private", "organization_only")
RESUME_TEXT_CAP = 50_000

# ----------------------------------------------------------------------------------------------- contact scrubbing

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_URL = re.compile(r"(?:https?://|www\.)\S+|\b(?:linkedin|github|gitlab|twitter|x|facebook|instagram)\.com/\S*", re.I)
_PHONE = re.compile(r"\+?\(?\d[\d\s().-]{6,}\d")
_SEPARATORS = re.compile(r"(?:\s*[|•·,;/]\s*){2,}")


def _strip_phone(match: re.Match) -> str:
    digits = sum(ch.isdigit() for ch in match.group(0))
    # 10-15 digits is a phone number; "2019 - 2021" (8 digits) or a pin code (6) stays.
    return "" if 10 <= digits <= 15 else match.group(0)


def scrub_contact_details(text: str | None) -> str:
    """The resume text without e-mail addresses, phone numbers and profile / web links."""
    out_lines: list[str] = []
    for line in str(text or "").splitlines():
        cleaned = _EMAIL.sub("", line)
        cleaned = _URL.sub("", cleaned)
        cleaned = _PHONE.sub(_strip_phone, cleaned)
        if cleaned != line:
            cleaned = _SEPARATORS.sub(" | ", cleaned)
            cleaned = re.sub(r"^[\s|•·,;:/-]+|[\s|•·,;:/-]+$", "", cleaned)
            cleaned = re.sub(r"\b(?:e-?mail|phone|mobile|tel|contact|linkedin|github)\s*:\s*$", "", cleaned, flags=re.I).strip()
            if not cleaned:
                continue
        out_lines.append(cleaned)
    return "\n".join(out_lines).strip()


# ----------------------------------------------------------------------------------------------- filters


def _int_or_none(value: Any) -> int | None:
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return None


def normalize_platform_filters(params: dict | None) -> dict:
    p = params or {}
    limit = _int_or_none(p.get("limit")) or PAGE_SIZE_DEFAULT
    offset = _int_or_none(p.get("offset")) or 0
    interviewed = str(p.get("interviewed") or "").strip().lower()
    sort = str(p.get("sort") or "").strip().lower()
    min_score = _int_or_none(p.get("minScore"))
    exp_min = _int_or_none(p.get("expMin"))
    return {
        "q": str(p.get("q") or p.get("keywords") or "").strip()[:200],
        "location": str(p.get("location") or "").strip()[:80],
        "expMin": exp_min if exp_min is not None and 0 <= exp_min <= 60 else None,
        "minScore": min_score if min_score is not None and 0 <= min_score <= 100 else None,
        "interviewed": interviewed if interviewed in ("yes", "no") else "",
        "linkedOnly": str(p.get("linked") or p.get("applied") or "").strip().lower() in ("1", "true", "yes"),
        "sort": sort if sort in ("recent", "score", "experience") else "recent",
        "limit": max(1, min(limit, PAGE_SIZE_MAX)),
        "offset": max(0, min(offset, 100_000)),
    }


def _search_terms(q: str) -> list[str]:
    return [t for t in re.split(r"[\s,]+", q.lower()) if t and t not in ("and", "&")][:8]


def _looks_like_contact(term: str) -> bool:
    """A search for an e-mail or phone number must not reveal contact details hidden in the resume text."""
    return "@" in term or sum(ch.isdigit() for ch in term) >= 5


_EXP_NUM = re.compile(r"\d+(?:\.\d+)?")


def _experience_number(profile: dict) -> float | None:
    m = _EXP_NUM.search(str(profile.get("totalExperience") or profile.get("experienceYears") or ""))
    return float(m.group(0)) if m else None


def _score_of(interview: Any) -> float | None:
    if isinstance(interview, dict):
        v = interview.get("overall")
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return float(v)
    return None


# ----------------------------------------------------------------------------------------------- links to the org


def _org_links(db: dict, organization_id: str, database_url: str, recruiter_scope: dict | None) -> dict[str, dict]:
    """email -> {"apps": [application records], "source": "application" | "interview"} for this organisation."""
    recruiter_job_ids = None
    if recruiter_scope and recruiter_scope.get("createdByUserId"):
        recruiter_job_ids = {j["id"] for j in list_org_jobs(db, organization_id, recruiter_scope)}
    links: dict[str, dict] = {}
    apps = employer_apps_for_org(db, organization_id)
    profiles_for_emails(db, [a.get("candidateEmail") for a in apps])
    interviews_for_emails(db, [a.get("candidateEmail") for a in apps])
    for app in apps:
        if recruiter_job_ids is not None and app.get("jobId") not in recruiter_job_ids:
            continue
        email = str(app.get("candidateEmail") or "").strip().lower()
        if not email:
            continue
        entry = links.setdefault(email, {"apps": [], "source": "application"})
        entry["source"] = "application"
        entry["apps"].append(_with_stored_interview(db, _record_from_application(app, db)))
    for session in sessions_for_org(db, organization_id):
        email = str(session.get("email") or "").strip().lower()
        if not email or not session.get("result"):
            continue
        if recruiter_job_ids is not None and session.get("jobId") and session.get("jobId") not in recruiter_job_ids:
            continue
        links.setdefault(email, {"apps": [], "source": "interview"})
    if database_url.strip():
        ids = _list_organization_talent_user_ids(database_url, organization_id)
        for user in find_users_by_ids(db, ids):
            email = str((user or {}).get("email") or "").strip().lower()
            if email:
                links.setdefault(email, {"apps": [], "source": "interview"})
    return links


# ----------------------------------------------------------------------------------------------- rows


def _platform_record(db: dict, user: dict, profile: dict, interview: dict | None, links: dict[str, dict]) -> dict:
    email = str(user.get("email") or "").strip().lower()
    row = _with_stored_interview(db, _record_from_profile(db, user, profile, interview, "platform"))
    row["id"] = f"talent-{user.get('id')}"
    link = links.get(email)
    if link:
        for app in link["apps"]:
            row = _merge_records(row, app)
        if not link["apps"]:
            row["source"] = link["source"]
        # One row per person: the id stays the person's, whatever application was merged in, and the person's own
        # phone / role / experience (an application's empty or job-specific fields must not replace them).
        row["id"] = f"talent-{user.get('id')}"
        row["candidatePhone"] = str(profile.get("phone") or user.get("phone") or row.get("candidatePhone") or "")
        row["candidateRole"] = str(profile.get("currentRole") or row.get("candidateRole") or "").strip()
        row["experienceYears"] = str(
            profile.get("totalExperience") or profile.get("experienceYears") or row.get("experienceYears") or ""
        ).strip()
    row["candidateLocation"] = str(profile.get("currentLocation") or profile.get("location") or "").strip()
    row["candidateHeadline"] = str(profile.get("currentRole") or "").strip()
    row["profileUpdatedAt"] = profile.get("updatedAt") or ""
    row["lastActiveAt"] = _last_active(user, profile, row)
    row["resumeText"] = str(profile.get("resumeText") or row.get("resumeText") or "")[:RESUME_TEXT_CAP]
    row["resumeName"] = profile.get("resumeName") or row.get("resumeName")
    # The original upload lives in object storage at resumeStoragePath. The list only says whether that file exists.
    row["hasResumeFile"] = bool(str(profile.get("resumeStoragePath") or "").strip())
    return row


def _last_active(user: dict, profile: dict, row: dict) -> str:
    dates = [
        user.get("lastLoginAt"),
        profile.get("updatedAt"),
        (row.get("interviewResult") or {}).get("date") if isinstance(row.get("interviewResult"), dict) else None,
        row.get("appliedAt"),
        user.get("createdAt"),
    ]
    vals = sorted(str(d) for d in dates if d)
    return vals[-1] if vals else ""


def _finish_rows(db: dict, rows: list[dict]) -> list[dict]:
    """Drops rows of hidden profiles (defence in depth: the queries already leave them out) and marks the rest open."""
    return redact_roster_rows(db, rows)


# ----------------------------------------------------------------------------------------------- in-memory path


def _visible(profile: dict, email: str, links: dict) -> bool:
    return str(profile.get("profileVisibility") or "marketplace") not in HIDDEN_VISIBILITY or email in links


def _matches_memory(user: dict, profile: dict, interview: dict | None, f: dict, links: dict) -> bool:
    email = str(user.get("email") or "").lower()
    if f["linkedOnly"] and email not in links:
        return False
    score = _score_of(interview)
    if f["interviewed"] == "yes" and score is None:
        return False
    if f["interviewed"] == "no" and score is not None:
        return False
    if f["minScore"] is not None and (score is None or score < f["minScore"]):
        return False
    if f["expMin"] is not None:
        exp = _experience_number(profile)
        if exp is None or exp < f["expMin"]:
            return False
    if f["location"]:
        hay = f"{profile.get('currentLocation') or ''} {profile.get('location') or ''} {str(profile.get('resumeText') or '')[:400]}"
        if f["location"].lower() not in hay.lower():
            return False
    for term in _search_terms(f["q"]):
        name_blob = f"{user.get('name') or ''} {profile.get('fullName') or ''}".lower()
        if _looks_like_contact(term):
            if term not in name_blob:
                return False
            continue
        skills = profile.get("skills") if isinstance(profile.get("skills"), list) else []
        blob = " ".join(
            [name_blob, str(profile.get("currentRole") or ""), " ".join(map(str, skills)), str(profile.get("resumeText") or ""),
             str(profile.get("currentLocation") or "")]
        ).lower()
        if term not in blob:
            return False
    return True


def _list_memory(db: dict, f: dict, links: dict) -> tuple[list[tuple[dict, dict, dict | None]], int, dict]:
    users = [u for u in db.get("users") or [] if str(u.get("role") or "jobseeker").lower() == "jobseeker"]
    team = recruiter_member_user_ids(db, [u.get("id") for u in users])
    profiles = db.get("profiles") or {}
    interviews = db.get("interviews") or {}
    visible = []
    for u in users:
        if str(u.get("id")) in team:
            continue
        email = str(u.get("email") or "").lower()
        if not email:
            continue
        profile = profiles.get(email) or {}
        if not vendor_directory_profile_ok(email, profile.get("resumeText")):
            continue
        if _visible(profile, email, links):
            visible.append((u, profile, interviews.get(email)))
    stats = _stats_from(visible)
    matched = [t for t in visible if _matches_memory(t[0], t[1], t[2], f, links)]
    matched.sort(key=lambda t: _sort_key(t, f["sort"]), reverse=True)
    return matched[f["offset"] : f["offset"] + f["limit"]], len(matched), stats


def _sort_key(t: tuple[dict, dict, dict | None], sort: str):
    user, profile, interview = t
    recent = max(str(user.get("lastLoginAt") or ""), str(profile.get("updatedAt") or ""), str(user.get("createdAt") or ""))
    if sort == "score":
        s = _score_of(interview)
        return (s is not None, s or 0, recent)
    if sort == "experience":
        e = _experience_number(profile)
        return (e is not None, e or 0, recent)
    return (recent,)


def _stats_from(visible: list[tuple[dict, dict, dict | None]]) -> dict:
    scores = [s for s in (_score_of(t[2]) for t in visible) if s is not None]
    return {
        "total": len(visible),
        "parsed": sum(1 for t in visible if str(t[1].get("resumeText") or "").strip()),
        "interviewed": len(scores),
        "averageScore": round(sum(scores) / len(scores)) if scores else None,
    }


# ----------------------------------------------------------------------------------------------- Postgres path

def platform_candidate_from_where() -> str:
    """Shared FROM/WHERE for the vendor candidate list, including resume and demo-account guards."""
    return f"""
  FROM users u
  LEFT JOIN profiles p ON lower(p.email) = lower(u.email)
  LEFT JOIN interview_results ir ON lower(ir.email) = lower(u.email)
  WHERE lower(COALESCE(u.role, 'jobseeker')) = 'jobseeker'
    AND NOT EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.user_id = u.id AND om.role IN ('owner', 'admin', 'recruiter')
    )
    AND (
      COALESCE(p.data->>'profileVisibility', 'marketplace') NOT IN ('private', 'organization_only')
      OR lower(u.email) = ANY(%(linked)s)
    )
    AND {vendor_roster_profile_sql()}
"""

_SCORE_SQL = "(CASE WHEN jsonb_typeof(ir.data->'overall') = 'number' THEN (ir.data->>'overall')::numeric END)"
_EXP_SQL = (
    "(NULLIF(substring(COALESCE(p.data->>'totalExperience', p.data->>'experienceYears', '') "
    "from '[0-9]+(?:[.][0-9]+)?'), ''))::numeric"
)
_RECENT_SQL = "GREATEST(u.last_login_at, p.updated_at, ir.updated_at, u.created_at)"


def _pg_filters(f: dict, links: dict) -> tuple[str, dict]:
    parts: list[str] = []
    params: dict[str, Any] = {"linked": sorted(links)}
    if f["linkedOnly"]:
        parts.append("AND lower(u.email) = ANY(%(linked)s)")
    if f["interviewed"] == "yes":
        parts.append(f"AND {_SCORE_SQL} IS NOT NULL")
    elif f["interviewed"] == "no":
        parts.append(f"AND {_SCORE_SQL} IS NULL")
    if f["minScore"] is not None:
        parts.append(f"AND {_SCORE_SQL} >= %(min_score)s")
        params["min_score"] = f["minScore"]
    if f["expMin"] is not None:
        parts.append(f"AND {_EXP_SQL} >= %(exp_min)s")
        params["exp_min"] = f["expMin"]
    if f["location"]:
        parts.append(
            "AND (COALESCE(p.data->>'currentLocation', '') ILIKE %(loc)s OR COALESCE(p.data->>'location', '') ILIKE %(loc)s"
            " OR left(COALESCE(p.data->>'resumeText', ''), 400) ILIKE %(loc)s)"
        )
        params["loc"] = f"%{f['location']}%"
    for i, term in enumerate(_search_terms(f["q"])):
        key = f"t{i}"
        params[key] = f"%{term}%"
        if _looks_like_contact(term):
            parts.append(f"AND (u.name ILIKE %({key})s OR COALESCE(p.data->>'fullName', '') ILIKE %({key})s)")
            continue
        parts.append(
            f"""AND (u.name ILIKE %({key})s
                 OR COALESCE(p.data->>'fullName', '') ILIKE %({key})s
                 OR COALESCE(p.data->>'currentRole', '') ILIKE %({key})s
                 OR COALESCE(p.data->>'currentLocation', '') ILIKE %({key})s
                 OR COALESCE(p.data->>'skills', '') ILIKE %({key})s
                 OR COALESCE(p.data->>'resumeText', '') ILIKE %({key})s)"""
        )
    return " ".join(parts), params


def _list_postgres(database_url: str, f: dict, links: dict) -> tuple[list[dict], int, dict]:
    where, params = _pg_filters(f, links)
    params = {**params, **_vendor_roster_sql_params()}
    base = platform_candidate_from_where()
    order = {
        "score": f"{_SCORE_SQL} DESC NULLS LAST, {_RECENT_SQL} DESC NULLS LAST",
        "experience": f"{_EXP_SQL} DESC NULLS LAST, {_RECENT_SQL} DESC NULLS LAST",
    }.get(f["sort"], f"{_RECENT_SQL} DESC NULLS LAST")
    pool = db_pool(database_url)
    with pool.connection() as conn:
        rows = conn.execute(
            f"""SELECT u.id, u.email, u.name, u.phone, u.created_at, u.last_login_at,
                       p.data AS profile_data, p.updated_at AS profile_updated_at,
                       ir.data AS interview_data
                {base} {where}
                ORDER BY {order}, u.id
                LIMIT %(limit)s OFFSET %(offset)s""",
            {**params, "limit": f["limit"], "offset": f["offset"]},
        ).fetchall()
        total = conn.execute(f"SELECT COUNT(*)::int AS n {base} {where}", params).fetchone()
        stats = conn.execute(
            f"""SELECT COUNT(*)::int AS total,
                       COUNT(*) FILTER (WHERE COALESCE(p.data->>'resumeText', '') <> '')::int AS parsed,
                       COUNT({_SCORE_SQL})::int AS interviewed,
                       ROUND(AVG({_SCORE_SQL}))::int AS average_score
                {base}""",
            {"linked": params["linked"], **_vendor_roster_sql_params()},
        ).fetchone()
    return (
        [dict(r) for r in rows],
        int((total or {}).get("n") or 0),
        {
            "total": int((stats or {}).get("total") or 0),
            "parsed": int((stats or {}).get("parsed") or 0),
            "interviewed": int((stats or {}).get("interviewed") or 0),
            "averageScore": (stats or {}).get("average_score"),
        },
    )


def _iso(value: Any) -> str:
    return value.isoformat() if hasattr(value, "isoformat") else str(value or "")


# ----------------------------------------------------------------------------------------------- entry point


async def list_platform_candidates(
    db: dict,
    organization_id: str,
    database_url: str,
    params: dict | None = None,
    recruiter_scope: dict | None = None,
) -> dict[str, Any]:
    f = normalize_platform_filters(params)
    links = await asyncio.to_thread(_org_links, db, organization_id, database_url or "", recruiter_scope)
    rows: list[dict] = []
    if (database_url or "").strip():
        found, total, stats = await asyncio.to_thread(_list_postgres, database_url, f, links)
        interviews_for_emails(db, [r.get("email") for r in found if not isinstance(r.get("interview_data"), dict)])
        for r in found:
            profile = dict(r.get("profile_data") or {}) if isinstance(r.get("profile_data"), dict) else {}
            if not profile.get("updatedAt") and r.get("profile_updated_at"):
                profile["updatedAt"] = _iso(r["profile_updated_at"])
            interview = r.get("interview_data") if isinstance(r.get("interview_data"), dict) else None
            user = {
                "id": r["id"],
                "email": str(r["email"] or "").lower(),
                "name": r.get("name"),
                "phone": r.get("phone"),
                "createdAt": _iso(r.get("created_at")),
                "lastLoginAt": _iso(r.get("last_login_at")) if r.get("last_login_at") else "",
                "role": "jobseeker",
            }
            rows.append(_platform_record(db, user, profile, interview, links))
    else:
        page, total, stats = _list_memory(db, f, links)
        for user, profile, interview in page:
            u = {**user, "email": str(user.get("email") or "").lower()}
            rows.append(_platform_record(db, u, profile, interview, links))
    candidates = await asyncio.to_thread(_finish_rows, db, rows)
    return {
        "scope": "platform",
        "total": total,
        "limit": f["limit"],
        "offset": f["offset"],
        "stats": stats,
        "candidates": candidates,
    }


__all__ = [
    "LINKED_ROSTER_SOURCES",
    "candidate_shares_contact",
    "list_platform_candidates",
    "normalize_platform_filters",
    "scrub_contact_details",
]
