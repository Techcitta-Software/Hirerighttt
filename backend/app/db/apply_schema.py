"""Apply Postgres schema (same SQL files as Node applySchema.mjs)."""

from __future__ import annotations

from pathlib import Path

from app.db.row_utils import row_value

SQL_DIR = Path(__file__).resolve().parents[2] / "db" / "sql"
MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "db" / "migrations"

SCHEMA_FILES = [
    "schema.sql",
    "schema-talent-search.sql",
    "schema-assessment.sql",
    "schema-interview-invites.sql",
    "schema-files.sql",
    "schema-role-skills.sql",
    "schema-password-reset.sql",
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
    "password_reset_tokens",
    "schema_migrations",
]


def read_all_schema_sql() -> str:
    parts: list[str] = []
    for name in SCHEMA_FILES:
        parts.append((SQL_DIR / name).read_text(encoding="utf-8"))
    return "\n".join(parts)


def apply_schema(conn) -> None:  # psycopg connection
    """Baseline schema (idempotent CREATE ... IF NOT EXISTS), then any versioned migrations not yet applied."""
    sql = read_all_schema_sql()
    with conn.cursor() as cur:
        # Several API workers / containers start at once: only one applies the schema at a time (the others wait,
        # then find everything already in place). Concurrent CREATE ... IF NOT EXISTS can otherwise collide.
        # A transaction-level lock is released by the caller's commit.
        cur.execute("SELECT pg_advisory_xact_lock(872341)")
        cur.execute(sql)
    apply_migrations(conn)


def migration_files() -> list[Path]:
    return sorted(MIGRATIONS_DIR.glob("*.sql")) if MIGRATIONS_DIR.is_dir() else []


def apply_migrations(conn) -> list[str]:
    """Run each db/migrations/NNNN_name.sql exactly once, in order. Applied versions live in schema_migrations.

    Add a new numbered file for every schema change instead of editing the baseline files, so existing databases
    (Neon) and fresh ones converge on the same schema. A file's checksum is stored; editing an applied migration
    is refused so history cannot silently diverge.
    """
    import hashlib

    applied_now: list[str] = []
    with conn.cursor() as cur:
        cur.execute(
            """CREATE TABLE IF NOT EXISTS schema_migrations (
                 version TEXT PRIMARY KEY,
                 checksum TEXT NOT NULL,
                 applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
               )"""
        )
        cur.execute("SELECT version, checksum FROM schema_migrations")
        done = {row_value(row, "version", 0): row_value(row, "checksum", 1) for row in cur.fetchall()}
        for path in migration_files():
            version = path.stem
            body = path.read_text(encoding="utf-8")
            checksum = hashlib.sha256(body.encode("utf-8")).hexdigest()
            if version in done:
                if done[version] != checksum:
                    raise RuntimeError(f"Migration {version} was edited after it was applied. Add a new migration instead.")
                continue
            cur.execute(body)
            cur.execute("INSERT INTO schema_migrations (version, checksum) VALUES (%s, %s)", (version, checksum))
            applied_now.append(version)
    return applied_now
