"""
One-way copy: Neon Postgres -> DynamoDB (does not delete or modify Neon data).

Usage (from backend/):
  python dynamo_init.py --migrate [--table users,jobs,...] [--dry-run] [--batch 25]

Requires DATABASE_URL (Neon) and AWS credentials for DynamoDB tables created via dynamo_init.py.
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timezone
from typing import Any, Callable, Iterable

import boto3
import psycopg
from botocore.exceptions import ClientError
from psycopg.rows import dict_row

from app.db.dynamo.key_patterns import (
    sanitize_item,
    audit_gsi1_org_time,
    audit_pk,
    audit_sk,
    gsi1_email_user,
    gsi1_slug_org,
    gsi2_org_jobs,
    gsi2_share_job,
    gsi3_candidate_applications,
    gsi3_org_applications,
    gsi4_invite_token,
    gsi4_marketplace_talent,
    neon_row_as_data,
    pk_email,
    pk_org,
    pk_platform,
    pk_reset_token_hash,
    pk_session_token,
    pk_user,
    row_to_item,
    sk_application,
    sk_artifact,
    sk_assessment,
    sk_interview_history,
    sk_interview_invite,
    sk_interview_result,
    sk_interview_session,
    sk_job,
    sk_job_application,
    sk_member,
    sk_meta,
    sk_plan,
    sk_profile,
    sk_recording,
    sk_role_skill,
    sk_saved_search,
    sk_stored_file,
    sk_subscription,
    sk_talent_access,
    sk_talent_profile,
    sk_vault_candidate,
)
from app.db.dynamo.table_specs import AUDIT_TABLE, MAIN_TABLE, physical_table_name
from app.db.dynamo_config import dynamo_resource_kwargs
from app.node_config import config

BATCH_DEFAULT = 25


def _ttl_from_timestamptz(expires_at: Any) -> int | None:
    if expires_at is None:
        return None
    if isinstance(expires_at, datetime):
        dt = expires_at if expires_at.tzinfo else expires_at.replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    return None


def _audit_table():
    return boto3.resource("dynamodb", **dynamo_resource_kwargs()).Table(
        physical_table_name(AUDIT_TABLE.logical_name)
    )


def _main_table():
    return boto3.resource("dynamodb", **dynamo_resource_kwargs()).Table(
        physical_table_name(MAIN_TABLE.logical_name)
    )


def _batch_write(table, items: list[dict[str, Any]], *, dry_run: bool) -> int:
    if not items:
        return 0
    if dry_run:
        return len(items)
    written = 0
    with table.batch_writer(overwrite_by_pkeys=["pk", "sk"]) as batch:
        for item in items:
            batch.put_item(Item=sanitize_item(item))
            written += 1
    return written


def migrate_users(conn, table, *, dry_run: bool, batch: int) -> int:
    total = 0
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT * FROM users ORDER BY created_at")
        buf: list[dict[str, Any]] = []
        for row in cur:
            data = neon_row_as_data(row)
            uid = data["id"]
            email = data.get("email") or ""
            item = row_to_item(
                pk=pk_user(uid),
                sk=sk_meta(),
                entity_type="user",
                data=data,
                gsi=gsi1_email_user(email, uid),
                created_at=data.get("created_at"),
                updated_at=data.get("created_at"),
            )
            buf.append(item)
            if len(buf) >= batch:
                total += _batch_write(table, buf, dry_run=dry_run)
                buf.clear()
        total += _batch_write(table, buf, dry_run=dry_run)
    return total


def migrate_organizations(conn, table, *, dry_run: bool, batch: int) -> int:
    total = 0
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT * FROM organizations ORDER BY created_at")
        buf: list[dict[str, Any]] = []
        for row in cur:
            data = neon_row_as_data(row)
            oid = data["id"]
            gsi = gsi1_slug_org(data.get("slug") or "", oid)
            item = row_to_item(
                pk=pk_org(oid),
                sk=sk_meta(),
                entity_type="organization",
                data=data,
                gsi=gsi,
                created_at=data.get("created_at"),
                updated_at=data.get("updated_at"),
            )
            buf.append(item)
            if len(buf) >= batch:
                total += _batch_write(table, buf, dry_run=dry_run)
                buf.clear()
        total += _batch_write(table, buf, dry_run=dry_run)
    return total


def migrate_subscription_plans(conn, table, *, dry_run: bool, batch: int) -> int:
    total = 0
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT * FROM subscription_plans ORDER BY sort_order")
        buf: list[dict[str, Any]] = []
        for row in cur:
            data = neon_row_as_data(row)
            pid = data["id"]
            item = row_to_item(
                pk=pk_platform(),
                sk=sk_plan(pid),
                entity_type="subscription_plan",
                data=data,
                created_at=data.get("created_at"),
                updated_at=data.get("created_at"),
            )
            buf.append(item)
            if len(buf) >= batch:
                total += _batch_write(table, buf, dry_run=dry_run)
                buf.clear()
        total += _batch_write(table, buf, dry_run=dry_run)
    return total


def migrate_organization_subscriptions(conn, table, *, dry_run: bool, batch: int) -> int:
    total = 0
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT * FROM organization_subscriptions")
        buf: list[dict[str, Any]] = []
        for row in cur:
            data = neon_row_as_data(row)
            oid = data["organization_id"]
            item = row_to_item(
                pk=pk_org(oid),
                sk=sk_subscription(),
                entity_type="organization_subscription",
                data=data,
                created_at=data.get("created_at"),
                updated_at=data.get("updated_at"),
            )
            buf.append(item)
            if len(buf) >= batch:
                total += _batch_write(table, buf, dry_run=dry_run)
                buf.clear()
        total += _batch_write(table, buf, dry_run=dry_run)
    return total


def migrate_hireright_sessions(conn, table, *, dry_run: bool, batch: int) -> int:
    total = 0
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT * FROM hireright_sessions")
        buf: list[dict[str, Any]] = []
        for row in cur:
            data = neon_row_as_data(row)
            token = data["token"]
            item = row_to_item(
                pk=pk_session_token(token),
                sk=sk_meta(),
                entity_type="hireright_session",
                data=data,
                gsi=gsi1_email_user(data.get("email") or "", token),
                ttl_epoch=_ttl_from_timestamptz(data.get("expires_at")),
                created_at=data.get("created_at"),
                updated_at=data.get("created_at"),
            )
            buf.append(item)
            if len(buf) >= batch:
                total += _batch_write(table, buf, dry_run=dry_run)
                buf.clear()
        total += _batch_write(table, buf, dry_run=dry_run)
    return total


def migrate_organization_members(conn, table, *, dry_run: bool, batch: int) -> int:
    total = 0
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT * FROM organization_members")
        buf: list[dict[str, Any]] = []
        for row in cur:
            data = neon_row_as_data(row)
            oid = data["organization_id"]
            uid = data["user_id"]
            item = row_to_item(
                pk=pk_org(oid),
                sk=sk_member(uid),
                entity_type="organization_member",
                data=data,
                gsi=gsi1_email_user(uid, uid),  # Gsi1 optional; query by org PK
                created_at=data.get("joined_at"),
                updated_at=data.get("joined_at"),
            )
            buf.append(item)
            if len(buf) >= batch:
                total += _batch_write(table, buf, dry_run=dry_run)
                buf.clear()
        total += _batch_write(table, buf, dry_run=dry_run)
    return total


def migrate_profiles(conn, table, *, dry_run: bool, batch: int) -> int:
    total = 0
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT * FROM profiles")
        buf: list[dict[str, Any]] = []
        for row in cur:
            data = neon_row_as_data(row)
            email = data.get("email") or ""
            uid = data.get("user_id")
            pk = pk_user(uid) if uid else pk_email(email)
            item = row_to_item(
                pk=pk,
                sk=sk_profile(),
                entity_type="profile",
                data=data,
                gsi=gsi1_email_user(email, uid or email),
                created_at=data.get("updated_at"),
                updated_at=data.get("updated_at"),
            )
            buf.append(item)
            if len(buf) >= batch:
                total += _batch_write(table, buf, dry_run=dry_run)
                buf.clear()
        total += _batch_write(table, buf, dry_run=dry_run)
    return total


def migrate_jobs(conn, table, *, dry_run: bool, batch: int) -> int:
    total = 0
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT * FROM jobs ORDER BY created_at")
        buf: list[dict[str, Any]] = []
        for row in cur:
            data = neon_row_as_data(row)
            oid = data["organization_id"]
            jid = data["id"]
            gsi = {
                **gsi2_share_job(data.get("shareable_code") or "", jid),
                **gsi2_org_jobs(oid, jid, data.get("status") or ""),
            }
            item = row_to_item(
                pk=pk_org(oid),
                sk=sk_job(jid),
                entity_type="job",
                data=data,
                gsi=gsi,
                created_at=data.get("created_at"),
                updated_at=data.get("updated_at"),
            )
            buf.append(item)
            if len(buf) >= batch:
                total += _batch_write(table, buf, dry_run=dry_run)
                buf.clear()
        total += _batch_write(table, buf, dry_run=dry_run)
    return total


def migrate_employer_applications(conn, table, *, dry_run: bool, batch: int) -> int:
    total = 0
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT * FROM employer_applications ORDER BY applied_at")
        buf: list[dict[str, Any]] = []
        for row in cur:
            data = neon_row_as_data(row)
            oid = data["organization_id"]
            aid = data["id"]
            applied = data.get("applied_at")
            item = row_to_item(
                pk=pk_org(oid),
                sk=sk_application(aid),
                entity_type="employer_application",
                data=data,
                gsi=gsi3_org_applications(oid, aid, str(applied) if applied else ""),
                created_at=str(applied) if applied else None,
                updated_at=str(applied) if applied else None,
            )
            buf.append(item)
            if len(buf) >= batch:
                total += _batch_write(table, buf, dry_run=dry_run)
                buf.clear()
        total += _batch_write(table, buf, dry_run=dry_run)
    return total


def migrate_job_applications(conn, table, *, dry_run: bool, batch: int) -> int:
    total = 0
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT * FROM job_applications ORDER BY created_at")
        buf: list[dict[str, Any]] = []
        for row in cur:
            data = neon_row_as_data(row)
            email = data.get("email") or ""
            aid = data["id"]
            created = data.get("created_at")
            item = row_to_item(
                pk=pk_email(email),
                sk=sk_job_application(aid),
                entity_type="job_application",
                data=data,
                gsi=gsi3_candidate_applications(email, aid, str(created) if created else ""),
                created_at=str(created) if created else None,
                updated_at=str(created) if created else None,
            )
            buf.append(item)
            if len(buf) >= batch:
                total += _batch_write(table, buf, dry_run=dry_run)
                buf.clear()
        total += _batch_write(table, buf, dry_run=dry_run)
    return total


def migrate_interview_results(conn, table, *, dry_run: bool, batch: int) -> int:
    total = 0
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT * FROM interview_results")
        buf: list[dict[str, Any]] = []
        for row in cur:
            data = neon_row_as_data(row)
            email = data.get("email") or ""
            pk = pk_email(email)
            oid = data.get("organization_id")
            gsi = {"gsi3pk": pk_org(oid) if oid else pk_email(email), "gsi3sk": f"RESULT#{email}"}
            item = row_to_item(
                pk=pk,
                sk=sk_interview_result(),
                entity_type="interview_result",
                data=data,
                gsi=gsi,
                updated_at=data.get("updated_at"),
            )
            buf.append(item)
            if len(buf) >= batch:
                total += _batch_write(table, buf, dry_run=dry_run)
                buf.clear()
        total += _batch_write(table, buf, dry_run=dry_run)
    return total


def migrate_interview_sessions(conn, table, *, dry_run: bool, batch: int) -> int:
    total = 0
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT * FROM interview_sessions")
        buf: list[dict[str, Any]] = []
        for row in cur:
            data = neon_row_as_data(row)
            sid = data["session_id"]
            email = data.get("email") or ""
            item = row_to_item(
                pk=pk_email(email),
                sk=sk_interview_session(sid),
                entity_type="interview_session",
                data=data,
                updated_at=data.get("updated_at"),
            )
            buf.append(item)
            if len(buf) >= batch:
                total += _batch_write(table, buf, dry_run=dry_run)
                buf.clear()
        total += _batch_write(table, buf, dry_run=dry_run)
    return total


def migrate_password_reset_tokens(conn, table, *, dry_run: bool, batch: int) -> int:
    total = 0
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT * FROM password_reset_tokens")
        buf: list[dict[str, Any]] = []
        for row in cur:
            data = neon_row_as_data(row)
            th = data["token_hash"]
            ttl = _ttl_from_timestamptz(data.get("expires_at"))
            item = row_to_item(
                pk=pk_reset_token_hash(th),
                sk=sk_meta(),
                entity_type="password_reset_token",
                data=data,
                ttl_epoch=ttl,
            )
            buf.append(item)
            if len(buf) >= batch:
                total += _batch_write(table, buf, dry_run=dry_run)
                buf.clear()
        total += _batch_write(table, buf, dry_run=dry_run)
    return total


def migrate_interview_invites(conn, table, *, dry_run: bool, batch: int) -> int:
    total = 0
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT * FROM interview_invites ORDER BY created_at")
        buf: list[dict[str, Any]] = []
        for row in cur:
            data = neon_row_as_data(row)
            token = data["token"]
            oid = data.get("organization_id")
            email = data.get("candidate_email") or ""
            pk = pk_org(oid) if oid else pk_email(email)
            item = row_to_item(
                pk=pk,
                sk=sk_interview_invite(token),
                entity_type="interview_invite",
                data=data,
                gsi=gsi4_invite_token(token),
                created_at=data.get("created_at"),
            )
            buf.append(item)
            if len(buf) >= batch:
                total += _batch_write(table, buf, dry_run=dry_run)
                buf.clear()
        total += _batch_write(table, buf, dry_run=dry_run)
    return total


def migrate_candidate_talent_profiles(conn, table, *, dry_run: bool, batch: int) -> int:
    total = 0
    with conn.cursor(row_factory=dict_row) as cur:
        try:
            cur.execute("SELECT * FROM candidate_talent_profiles")
        except psycopg.Error:
            conn.rollback()
            return 0
        buf: list[dict[str, Any]] = []
        for row in cur:
            data = neon_row_as_data(row)
            uid = data["user_id"]
            vis = data.get("profile_visibility") or "marketplace"
            item = row_to_item(
                pk=pk_user(uid),
                sk=sk_talent_profile(),
                entity_type="talent_profile",
                data=data,
                gsi=gsi4_marketplace_talent(vis, uid),
                updated_at=data.get("updated_at"),
            )
            buf.append(item)
            if len(buf) >= batch:
                total += _batch_write(table, buf, dry_run=dry_run)
                buf.clear()
        total += _batch_write(table, buf, dry_run=dry_run)
    return total


def migrate_organization_talent_access(conn, table, *, dry_run: bool, batch: int) -> int:
    total = 0
    with conn.cursor(row_factory=dict_row) as cur:
        try:
            cur.execute("SELECT * FROM organization_talent_access")
        except psycopg.Error:
            conn.rollback()
            return 0
        buf: list[dict[str, Any]] = []
        for row in cur:
            data = neon_row_as_data(row)
            oid = data["organization_id"]
            uid = data["user_id"]
            item = row_to_item(
                pk=pk_org(oid),
                sk=sk_talent_access(uid),
                entity_type="talent_access",
                data=data,
            )
            buf.append(item)
            if len(buf) >= batch:
                total += _batch_write(table, buf, dry_run=dry_run)
                buf.clear()
        total += _batch_write(table, buf, dry_run=dry_run)
    return total


def migrate_stored_files(conn, table, *, dry_run: bool, batch: int) -> int:
    total = 0
    with conn.cursor(row_factory=dict_row) as cur:
        try:
            cur.execute("SELECT * FROM stored_files")
        except psycopg.Error:
            conn.rollback()
            return 0
        buf: list[dict[str, Any]] = []
        for row in cur:
            data = neon_row_as_data(row)
            fid = data["id"]
            owner = str(data.get("owner_email") or "").lower()
            uid = data.get("owner_user_id")
            pk = pk_user(uid) if uid else pk_email(owner)
            item = row_to_item(
                pk=pk,
                sk=sk_stored_file(fid),
                entity_type="stored_file",
                data=data,
                created_at=data.get("created_at"),
            )
            buf.append(item)
            if len(buf) >= batch:
                total += _batch_write(table, buf, dry_run=dry_run)
                buf.clear()
        total += _batch_write(table, buf, dry_run=dry_run)
    return total


def migrate_interview_recordings(conn, table, *, dry_run: bool, batch: int) -> int:
    total = 0
    with conn.cursor(row_factory=dict_row) as cur:
        try:
            cur.execute("SELECT * FROM interview_recordings")
        except psycopg.Error:
            conn.rollback()
            return 0
        buf: list[dict[str, Any]] = []
        for row in cur:
            data = neon_row_as_data(row)
            rid = data["id"]
            tenant = data["tenant_id"]
            item = row_to_item(
                pk=f"TENANT#{tenant}",
                sk=sk_recording(rid),
                entity_type="interview_recording",
                data=data,
                created_at=data.get("created_at"),
                updated_at=data.get("updated_at"),
            )
            buf.append(item)
            if len(buf) >= batch:
                total += _batch_write(table, buf, dry_run=dry_run)
                buf.clear()
        total += _batch_write(table, buf, dry_run=dry_run)
    return total


def migrate_interview_artifacts(conn, table, *, dry_run: bool, batch: int) -> int:
    total = 0
    with conn.cursor(row_factory=dict_row) as cur:
        try:
            cur.execute("SELECT * FROM interview_artifacts")
        except psycopg.Error:
            conn.rollback()
            return 0
        buf: list[dict[str, Any]] = []
        for row in cur:
            data = neon_row_as_data(row)
            tenant = data["tenant_id"]
            iid = data["interview_id"]
            atype = data["artifact_type"]
            item = row_to_item(
                pk=f"TENANT#{tenant}",
                sk=sk_artifact(f"{iid}#{atype}"),
                entity_type="interview_artifact",
                data=data,
                created_at=data.get("created_at"),
                updated_at=data.get("updated_at"),
            )
            buf.append(item)
            if len(buf) >= batch:
                total += _batch_write(table, buf, dry_run=dry_run)
                buf.clear()
        total += _batch_write(table, buf, dry_run=dry_run)
    return total


def migrate_confidential_candidates(conn, table, *, dry_run: bool, batch: int) -> int:
    total = 0
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT * FROM confidential_candidates ORDER BY sort_order ASC, created_at DESC")
        buf: list[dict[str, Any]] = []
        for row in cur:
            data = neon_row_as_data(row)
            oid = data["organization_id"]
            cid = data["id"]
            item = row_to_item(
                pk=pk_org(oid),
                sk=sk_vault_candidate(cid),
                entity_type="confidential_candidate",
                data=data,
                created_at=data.get("created_at"),
            )
            buf.append(item)
            if len(buf) >= batch:
                total += _batch_write(table, buf, dry_run=dry_run)
                buf.clear()
        total += _batch_write(table, buf, dry_run=dry_run)
    return total


def migrate_interview_result_history(conn, table, *, dry_run: bool, batch: int) -> int:
    total = 0
    with conn.cursor(row_factory=dict_row) as cur:
        try:
            cur.execute("SELECT * FROM interview_result_history ORDER BY created_at")
        except psycopg.Error:
            conn.rollback()
            return 0
        buf: list[dict[str, Any]] = []
        for row in cur:
            data = neon_row_as_data(row)
            email = data.get("email") or ""
            hid = str(data.get("id"))
            item = row_to_item(
                pk=pk_email(email),
                sk=sk_interview_history(hid),
                entity_type="interview_result_history",
                data=data,
                created_at=data.get("created_at"),
            )
            buf.append(item)
            if len(buf) >= batch:
                total += _batch_write(table, buf, dry_run=dry_run)
                buf.clear()
        total += _batch_write(table, buf, dry_run=dry_run)
    return total


def migrate_audit_logs(conn, audit_table, *, dry_run: bool, batch: int) -> int:
    total = 0
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT * FROM audit_logs ORDER BY created_at")
        buf: list[dict[str, Any]] = []
        for row in cur:
            data = neon_row_as_data(row)
            oid = data.get("organization_id")
            created = data.get("created_at")
            aid = str(data.get("id"))
            created_s = created.isoformat() if isinstance(created, datetime) else str(created)
            item = row_to_item(
                pk=audit_pk(oid),
                sk=audit_sk(created_s, aid),
                entity_type="audit_log",
                data=data,
                gsi=audit_gsi1_org_time(oid, created_s, aid),
                created_at=created_s,
                updated_at=created_s,
            )
            buf.append(item)
            if len(buf) >= batch:
                total += _batch_write(audit_table, buf, dry_run=dry_run)
                buf.clear()
        total += _batch_write(audit_table, buf, dry_run=dry_run)
    return total


def migrate_generic_assessment(
    conn,
    table,
    *,
    sql_table: str,
    sk_prefix: str,
    entity_type: str,
    org_key: str = "organization_id",
    id_key: str = "id",
    dry_run: bool,
    batch: int,
) -> int:
    total = 0
    with conn.cursor(row_factory=dict_row) as cur:
        try:
            cur.execute(f"SELECT * FROM {sql_table}")
        except psycopg.Error:
            conn.rollback()
            return 0
        buf: list[dict[str, Any]] = []
        for row in cur:
            data = neon_row_as_data(row)
            oid = data.get(org_key) or data.get("candidate_id") or "unknown"
            eid = str(data.get(id_key) or data.get("session_id") or data.get("token"))
            pk = pk_org(oid) if org_key == "organization_id" else pk_user(str(oid))
            if org_key not in data and "candidate_id" in data:
                pk = pk_user(str(data["candidate_id"]))
            item = row_to_item(
                pk=pk,
                sk=sk_assessment(sk_prefix, eid),
                entity_type=entity_type,
                data=data,
            )
            buf.append(item)
            if len(buf) >= batch:
                total += _batch_write(table, buf, dry_run=dry_run)
                buf.clear()
        total += _batch_write(table, buf, dry_run=dry_run)
    return total


AUDIT_MIGRATORS = frozenset({"audit_logs", "assessment_events"})


def _assess_migrator(
    sql_table: str,
    sk_prefix: str,
    entity_type: str,
    org_key: str = "organization_id",
    id_key: str = "id",
) -> Callable[..., int]:
    def fn(conn, table, *, dry_run: bool, batch: int) -> int:
        return migrate_generic_assessment(
            conn,
            table,
            sql_table=sql_table,
            sk_prefix=sk_prefix,
            entity_type=entity_type,
            org_key=org_key,
            id_key=id_key,
            dry_run=dry_run,
            batch=batch,
        )

    return fn


MIGRATORS: dict[str, Callable[..., int]] = {}


def _register(name: str, fn: Callable[..., int]) -> None:
    MIGRATORS[name] = fn


_register("subscription_plans", migrate_subscription_plans)
_register("organizations", migrate_organizations)
_register("organization_subscriptions", migrate_organization_subscriptions)
_register("users", migrate_users)
_register("hireright_sessions", migrate_hireright_sessions)
_register("organization_members", migrate_organization_members)
_register("profiles", migrate_profiles)
_register("jobs", migrate_jobs)
_register("employer_applications", migrate_employer_applications)
_register("job_applications", migrate_job_applications)
_register("interview_results", migrate_interview_results)
_register("interview_sessions", migrate_interview_sessions)
_register("password_reset_tokens", migrate_password_reset_tokens)
_register("interview_invites", migrate_interview_invites)
_register("candidate_talent_profiles", migrate_candidate_talent_profiles)
_register("organization_talent_access", migrate_organization_talent_access)
_register("stored_files", migrate_stored_files)
_register("interview_recordings", migrate_interview_recordings)
_register("interview_artifacts", migrate_interview_artifacts)
_register("confidential_candidates", migrate_confidential_candidates)
_register("interview_result_history", migrate_interview_result_history)
_register("audit_logs", migrate_audit_logs)

for _name, _sql, _prefix, _etype, *_keys in (
    ("assessment_jobs", "assessment_jobs", "JOB", "assessment_job"),
    ("assessment_resumes", "assessment_resumes", "RESUME", "assessment_resume", "candidate_id", "id"),
    ("interview_plans", "interview_plans", "PLAN", "interview_plan"),
    ("interview_questions", "interview_questions", "QUESTION", "interview_question", "organization_id", "question_id"),
    ("assessment_sessions", "assessment_sessions", "SESSION", "assessment_session"),
    ("interview_answers", "interview_answers", "ANSWER", "interview_answer"),
    ("answer_evaluations", "answer_evaluations", "EVAL", "answer_evaluation"),
    ("recruiter_reviews", "recruiter_reviews", "REVIEW", "recruiter_review"),
    ("interview_reports", "interview_reports", "REPORT", "interview_report", "organization_id", "session_id"),
    ("assessment_usage", "assessment_usage", "USAGE", "assessment_usage"),
    ("personalized_interview_links", "personalized_interview_links", "PLINK", "personalized_interview_link", "candidate_id", "session_id"),
):
    org_k = _keys[0] if _keys else "organization_id"
    id_k = _keys[1] if len(_keys) > 1 else "id"
    _register(_name, _assess_migrator(_sql, _prefix, _etype, org_k, id_k))

_register(
    "assessment_events",
    _assess_migrator("assessment_events", "EVENT", "assessment_event"),
)


def migrate_all(
    database_url: str,
    *,
    tables: Iterable[str] | None = None,
    dry_run: bool = False,
    batch: int = BATCH_DEFAULT,
) -> dict[str, int]:
    selected = list(tables) if tables else list(MIGRATORS.keys())
    stats: dict[str, int] = {}
    main = _main_table()
    audit = _audit_table()
    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        for name in selected:
            if name not in MIGRATORS:
                print(f"[skip] unknown table: {name}", file=sys.stderr)
                continue
            fn = MIGRATORS[name]
            t0 = time.monotonic()
            if name in AUDIT_MIGRATORS:
                count = fn(conn, audit, dry_run=dry_run, batch=batch)
            else:
                count = fn(conn, main, dry_run=dry_run, batch=batch)
            stats[name] = count
            print(f"  {name}: {count} items ({time.monotonic() - t0:.1f}s)")
    return stats


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Copy Neon Postgres rows into DynamoDB (read-only on Neon).")
    parser.add_argument("--dry-run", action="store_true", help="Count transforms without writing to DynamoDB")
    parser.add_argument("--batch", type=int, default=BATCH_DEFAULT, help="Batch write size")
    parser.add_argument(
        "--table",
        action="append",
        dest="tables",
        help="Limit to specific Neon table names (repeatable). Default: all registered migrators.",
    )
    args = parser.parse_args(argv)

    url = (config.database_url or "").strip()
    if not url:
        print("DATABASE_URL is required (Neon). DynamoDB tables must exist (python dynamo_init.py).", file=sys.stderr)
        return 1

    print(f"Migrating Neon -> DynamoDB (dry_run={args.dry_run})...")
    try:
        stats = migrate_all(url, tables=args.tables, dry_run=args.dry_run, batch=args.batch)
    except ClientError as exc:
        print(f"DynamoDB error: {exc}", file=sys.stderr)
        return 1
    total = sum(stats.values())
    print(f"Done — {total} items across {len(stats)} entity groups.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())