"""
Report what is in DynamoDB vs what Neon has (when DATABASE_URL is set).
Usage: python scripts/dynamo_inventory.py
"""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.load_env import load_env

load_env()

import boto3
import psycopg
from psycopg.rows import dict_row

from app.db.dynamo.table_specs import physical_table_name
from app.db.dynamo_config import database_provider, dynamo_client_kwargs, dynamo_resource_kwargs
from app.db.dynamo_relational import load_db_dynamo
from app.node_config import config

NEON_TABLES = (
    "users",
    "organizations",
    "organization_members",
    "organization_subscriptions",
    "subscription_plans",
    "hireright_sessions",
    "profiles",
    "jobs",
    "employer_applications",
    "job_applications",
    "interview_results",
    "interview_sessions",
    "password_reset_tokens",
    "interview_invites",
    "candidate_talent_profiles",
    "organization_talent_access",
    "stored_files",
    "interview_recordings",
    "interview_artifacts",
    "confidential_candidates",
    "interview_result_history",
    "audit_logs",
    "assessment_jobs",
    "assessment_sessions",
)

ENTITY_FOR_NEON = {
    "users": "user",
    "organizations": "organization",
    "organization_members": "organization_member",
    "organization_subscriptions": "organization_subscription",
    "subscription_plans": "subscription_plan",
    "hireright_sessions": "hireright_session",
    "profiles": "profile",
    "jobs": "job",
    "employer_applications": "employer_application",
    "job_applications": "job_application",
    "interview_results": "interview_result",
    "interview_sessions": "interview_session",
    "password_reset_tokens": "password_reset_token",
    "interview_invites": "interview_invite",
    "candidate_talent_profiles": "talent_profile",
    "organization_talent_access": "talent_access",
    "stored_files": "stored_file",
    "interview_recordings": "interview_recording",
    "interview_artifacts": "interview_artifact",
    "confidential_candidates": "confidential_candidate",
    "interview_result_history": "interview_result_history",
    "audit_logs": "audit_log",
    "assessment_jobs": "assessment_job",
    "assessment_sessions": "assessment_session",
}


def _sts():
    sts = boto3.client("sts", **dynamo_client_kwargs())
    return sts.get_caller_identity()


def _scan_entity_counts(table_name: str) -> Counter:
    tbl = boto3.resource("dynamodb", **dynamo_resource_kwargs()).Table(table_name)
    counts: Counter = Counter()
    kwargs: dict = {"ProjectionExpression": "entity_type"}
    while True:
        resp = tbl.scan(**kwargs)
        for it in resp.get("Items", []):
            et = it.get("entity_type") or "UNKNOWN"
            counts[str(et)] += 1
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    return counts


def _neon_counts() -> dict[str, int]:
    url = (config.database_url or "").strip()
    if not url:
        return {}
    out: dict[str, int] = {}
    with psycopg.connect(url, row_factory=dict_row) as conn:
        for name in NEON_TABLES:
            try:
                with conn.cursor() as cur:
                    cur.execute(f"SELECT COUNT(*)::int AS c FROM {name}")
                    row = cur.fetchone()
                    out[name] = int(row["c"]) if row else 0
            except Exception:
                conn.rollback()
                out[name] = -1
    return out


def _load_shape_counts() -> dict[str, int]:
    db = load_db_dynamo()
    return {
        "users (loaded)": len(db.get("users") or []),
        "organizations (loaded)": len(db.get("organizations") or []),
        "jobs (loaded)": len(db.get("jobs") or []),
        "employerApplications (loaded)": len(db.get("employerApplications") or []),
        "job_applications emails (loaded)": len(db.get("applications") or {}),
        "profiles (loaded)": len(db.get("profiles") or {}),
        "interviewSessions (loaded)": len(db.get("interviewSessions") or {}),
        "confidentialVault (loaded)": len(db.get("confidentialVault") or []),
    }


def main() -> int:
    ident = _sts()
    main_t = physical_table_name("main")
    audit_t = physical_table_name("audit")

    print("=== DynamoDB inventory ===")
    print(f"DATABASE_PROVIDER={database_provider()}")
    print(f"AWS account: {ident.get('Account')}")
    print(f"AWS IAM:     {ident.get('Arn')}")
    print(f"Region:      {dynamo_client_kwargs().get('region_name')}")
    print(f"Main table:  {main_t}")
    print(f"Audit table: {audit_t}")
    print()

    main_counts = _scan_entity_counts(main_t)
    audit_counts = _scan_entity_counts(audit_t)
    total_main = sum(main_counts.values())
    total_audit = sum(audit_counts.values())

    print(f"Total items in MAIN:  {total_main}")
    print(f"Total items in AUDIT: {total_audit}")
    print()
    print("--- MAIN by entity_type ---")
    for et, n in sorted(main_counts.items(), key=lambda x: (-x[1], x[0])):
        print(f"  {et:40} {n:6}")

    if audit_counts:
        print("\n--- AUDIT by entity_type ---")
        for et, n in sorted(audit_counts.items(), key=lambda x: (-x[1], x[0])):
            print(f"  {et:40} {n:6}")

    print("\n--- App load_db_dynamo() (what API sees) ---")
    for k, v in _load_shape_counts().items():
        print(f"  {k}: {v}")

    neon = _neon_counts()
    if neon:
        print("\n--- Neon vs Dynamo (row counts) ---")
        print(f"{'Neon table':36} {'Neon':>8} {'Dynamo entity':>28} {'Dynamo':>8}  match")
        for tbl in NEON_TABLES:
            nc = neon.get(tbl, -1)
            et = ENTITY_FOR_NEON.get(tbl, tbl)
            if tbl == "audit_logs":
                dc = audit_counts.get(et, 0)
            elif et.startswith("assessment_"):
                dc = main_counts.get(et, 0) + sum(v for k, v in main_counts.items() if k == et)
            else:
                dc = main_counts.get(et, 0)
            flag = ""
            if nc >= 0 and dc >= nc:
                flag = "OK"
            elif nc >= 0 and dc < nc:
                flag = "LOW — run npm run db:dynamo:migrate"
            elif nc < 0:
                flag = "neon table missing"
            neon_s = str(nc) if nc >= 0 else "n/a"
            print(f"  {tbl:34} {neon_s:>8} {et:28} {dc:8}  {flag}")
    else:
        print("\n(DATABASE_URL not set — skipping Neon comparison)")

    print("\n=== Console ===")
    print(f"Open AWS → DynamoDB → {dynamo_client_kwargs().get('region_name')} → Tables → {main_t} → Explore items")
    print("Filter/scan for attribute entity_type (e.g. job, user, interview_invite).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())