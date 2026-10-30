"""Apply Postgres schema (same SQL files as Node applySchema.mjs)."""

from __future__ import annotations

from pathlib import Path

SQL_DIR = Path(__file__).resolve().parents[2] / "db" / "sql"

SCHEMA_FILES = [
    "schema.sql",
    "schema-talent-search.sql",
    "schema-assessment.sql",
    "schema-interview-invites.sql",
    "schema-files.sql",
    "schema-role-skills.sql",
]

EXPECTED_TABLES = [
    "subscription_plans",
    "organizations",
    "organization_subscriptions",
    "hireright_sessions",
    "users",
    "organization_members",
    "organization_invites",
    "profiles",
    "jobs",
    "employer_applications",
    "job_applications",
    "interview_results",
    "interview_result_history",
    "interview_sessions",
    "confidential_candidates",
    "audit_logs",
    "candidate_talent_profiles",
    "organization_talent_access",
    "recruiter_saved_searches",
    "interview_invites",
    "assessment_jobs",
    "assessment_resumes",
    "interview_plans",
    "interview_questions",
    "assessment_sessions",
    "interview_answers",
    "answer_evaluations",
    "recruiter_reviews",
    "interview_reports",
    "assessment_events",
    "assessment_usage",
    "personalized_interview_links",
    "stored_files",
    "interview_recordings",
    "interview_artifacts",
    "role_skill_library",
]


def read_all_schema_sql() -> str:
    parts: list[str] = []
    for name in SCHEMA_FILES:
        parts.append((SQL_DIR / name).read_text(encoding="utf-8"))
    return "\n".join(parts)


def apply_schema(conn) -> None:  # psycopg connection
    sql = read_all_schema_sql()
    with conn.cursor() as cur:
        cur.execute(sql)
