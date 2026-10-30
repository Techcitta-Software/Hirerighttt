from __future__ import annotations

from pathlib import Path
from typing import Any

from app.db.store import db_pool

TALENT_SCHEMA = Path(__file__).resolve().parents[2] / "db" / "sql" / "schema-talent-search.sql"


def build_talent_record(user: dict, profile: dict, interview: dict | None = None) -> dict[str, Any]:
    skills_raw = profile.get("skills")
    if isinstance(skills_raw, list):
        skills = [str(s).strip() for s in skills_raw if str(s).strip()][:80]
    else:
        skills = [
            s.strip()
            for s in str(profile.get("keyStrengths") or "").split(",")
            if s.strip()
        ][:80]
    resume_snippet = str(
        profile.get("resumeText") or profile.get("experienceSummary") or profile.get("whoAreYou") or ""
    )[:12000]
    visibility = profile.get("profileVisibility")
    if visibility not in ("private", "organization_only"):
        visibility = "marketplace"
    interview_score = None
    if isinstance(interview, dict) and isinstance(interview.get("overall"), (int, float)):
        interview_score = interview["overall"]
    elif isinstance(profile.get("interviewScore"), (int, float)):
        interview_score = profile["interviewScore"]
    return {
        "userId": user["id"],
        "email": user["email"].lower(),
        "fullName": str(profile.get("fullName") or profile.get("name") or user.get("name") or user["email"]).strip(),
        "currentRole": str(profile.get("currentRole") or profile.get("whoAreYou") or "").strip(),
        "location": str(profile.get("currentLocation") or profile.get("location") or "").strip(),
        "experienceYears": str(profile.get("totalExperience") or profile.get("experienceYears") or "").strip(),
        "skills": skills,
        "summary": str(
            profile.get("whoAreYou") or profile.get("experienceSummary") or profile.get("whatDrivesYou") or ""
        )[:4000],
        "resumeSnippet": resume_snippet,
        "interviewScore": interview_score,
        "profileVisibility": visibility,
    }


async def ensure_talent_schema(database_url: str) -> None:
    sql = TALENT_SCHEMA.read_text(encoding="utf-8")
    pool = db_pool(database_url)
    with pool.connection() as conn:
        conn.execute(sql)
        conn.commit()


async def upsert_candidate_talent(
    database_url: str,
    user: dict,
    profile: dict,
    interview: dict | None = None,
) -> None:
    if not database_url or not user.get("id") or user.get("role") == "employer":
        return
    await ensure_talent_schema(database_url)
    row = build_talent_record(user, profile or {}, interview)
    pool = db_pool(database_url)
    with pool.connection() as conn:
        conn.execute(
            """INSERT INTO candidate_talent_profiles (
               user_id, email, full_name, role_title, location, experience_years,
               skills, summary, resume_snippet, interview_score, profile_visibility, updated_at
             ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW())
             ON CONFLICT (user_id) DO UPDATE SET
               email = EXCLUDED.email,
               full_name = EXCLUDED.full_name,
               role_title = EXCLUDED.role_title,
               location = EXCLUDED.location,
               experience_years = EXCLUDED.experience_years,
               skills = EXCLUDED.skills,
               summary = EXCLUDED.summary,
               resume_snippet = EXCLUDED.resume_snippet,
               interview_score = COALESCE(EXCLUDED.interview_score, candidate_talent_profiles.interview_score),
               profile_visibility = EXCLUDED.profile_visibility,
               updated_at = NOW()""",
            (
                row["userId"],
                row["email"],
                row["fullName"],
                row["currentRole"] or None,
                row["location"] or None,
                row["experienceYears"] or None,
                row["skills"],
                row["summary"] or None,
                row["resumeSnippet"] or None,
                row["interviewScore"],
                row["profileVisibility"],
            ),
        )
        conn.commit()


async def grant_organization_talent_access(
    database_url: str, organization_id: str, user_id: str, access_type: str = "application"
) -> None:
    if not database_url or not organization_id or not user_id:
        return
    await ensure_talent_schema(database_url)
    pool = db_pool(database_url)
    with pool.connection() as conn:
        conn.execute(
            """INSERT INTO organization_talent_access (organization_id, user_id, access_type)
               VALUES (%s, %s, %s)
               ON CONFLICT (organization_id, user_id) DO NOTHING""",
            (organization_id, user_id, access_type),
        )
        conn.commit()


async def search_candidate_talent(database_url: str, organization_id: str, filters: dict | None = None) -> dict:
    await ensure_talent_schema(database_url)
    filters = filters or {}
    limit = min(max(int(filters.get("limit") or 25), 1), 100)
    offset = max(int(filters.get("offset") or 0), 0)
    q = str(filters.get("q") or "").strip()
    location = str(filters.get("location") or "").strip()
    min_score = filters.get("minScore")
    skills = [str(s).strip().lower() for s in (filters.get("skills") or []) if str(s).strip()]
    experience = str(filters.get("experienceYears") or "").strip()
    where_parts = [
        """(
          t.profile_visibility = 'marketplace'
          OR EXISTS (
            SELECT 1 FROM organization_talent_access a
            WHERE a.organization_id = %s AND a.user_id = t.user_id
          )
        )
        AND t.profile_visibility <> 'private'"""
    ]
    sql_params: list = [organization_id]
    if isinstance(min_score, (int, float)):
        where_parts.append("AND t.interview_score IS NOT NULL AND t.interview_score >= %s")
        sql_params.append(min_score)
    if location:
        where_parts.append("AND t.location ILIKE %s")
        sql_params.append(f"%{location}%")
    if skills:
        where_parts.append(
            "AND EXISTS (SELECT 1 FROM unnest(t.skills) skill WHERE lower(skill) = ANY(%s::text[]))"
        )
        sql_params.append(skills)
    if experience:
        where_parts.append("AND t.experience_years ILIKE %s")
        sql_params.append(f"%{experience}%")
    rank_sel = "0::float AS rank"
    order = "t.interview_score DESC NULLS LAST, t.updated_at DESC"
    if q:
        where_parts.append(
            """AND (
              t.search_vector @@ plainto_tsquery('english', %s)
              OR t.full_name ILIKE '%' || %s || '%'
              OR t.role_title ILIKE '%' || %s || '%'
              OR t.resume_snippet ILIKE '%' || %s || '%'
            )"""
        )
        sql_params.extend([q, q, q, q])
        rank_sel = "ts_rank(t.search_vector, plainto_tsquery('english', %s)) AS rank"
        order = "rank DESC NULLS LAST, t.interview_score DESC NULLS LAST, t.updated_at DESC"
        sql_params.append(q)
    where_sql = " ".join(where_parts)
    pool = db_pool(database_url)
    with pool.connection() as conn:
        rows = conn.execute(
            f"""SELECT t.user_id, t.email, t.full_name, t.role_title, t.location, t.experience_years,
                       t.skills, t.summary, LEFT(t.resume_snippet, 500) AS resume_preview,
                       t.interview_score, t.profile_visibility, t.updated_at, {rank_sel}
                FROM candidate_talent_profiles t
                WHERE {where_sql}
                ORDER BY {order}
                LIMIT %s OFFSET %s""",
            (*sql_params, limit, offset),
        ).fetchall()
        count_row = conn.execute(
            f"SELECT COUNT(*)::int AS total FROM candidate_talent_profiles t WHERE {where_sql}",
            tuple(sql_params),
        ).fetchone()
    return {
        "total": count_row["total"] if count_row else 0,
        "candidates": [
            {
                "userId": r["user_id"],
                "email": r["email"],
                "fullName": r["full_name"],
                "currentRole": r["role_title"],
                "location": r["location"],
                "experienceYears": r["experience_years"],
                "skills": r["skills"] or [],
                "summary": r["summary"],
                "resumePreview": r["resume_preview"],
                "interviewScore": r["interview_score"],
                "profileVisibility": r["profile_visibility"],
                "updatedAt": r["updated_at"],
                "rank": r.get("rank"),
            }
            for r in rows
        ],
    }


async def get_candidate_talent_by_id(database_url: str, organization_id: str, user_id: str) -> dict | None:
    await ensure_talent_schema(database_url)
    pool = db_pool(database_url)
    with pool.connection() as conn:
        row = conn.execute(
            """SELECT t.*
               FROM candidate_talent_profiles t
               WHERE t.user_id = %s
                 AND t.profile_visibility <> 'private'
                 AND (
                   t.profile_visibility = 'marketplace'
                   OR EXISTS (
                     SELECT 1 FROM organization_talent_access a
                     WHERE a.organization_id = %s AND a.user_id = t.user_id
                   )
                 )""",
            (user_id, organization_id),
        ).fetchone()
    if not row:
        return None
    return {
        "userId": row["user_id"],
        "email": row["email"],
        "fullName": row["full_name"],
        "currentRole": row["role_title"],
        "location": row["location"],
        "experienceYears": row["experience_years"],
        "skills": row["skills"] or [],
        "summary": row["summary"],
        "resumeSnippet": row["resume_snippet"],
        "interviewScore": row["interview_score"],
        "profileVisibility": row["profile_visibility"],
        "updatedAt": row["updated_at"],
    }
