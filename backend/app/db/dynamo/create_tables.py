"""Create or verify HireRight DynamoDB tables (does not touch Neon/Postgres)."""

from __future__ import annotations

import sys
import time
from typing import Any

import boto3
from botocore.exceptions import ClientError

from app.db.dynamo_config import dynamo_client_kwargs, dynamo_resource_kwargs
from app.db.dynamo.table_specs import (
    ALL_TABLES,
    TableSpec,
    boto_table_create_kwargs,
    physical_table_name,
    point_in_time_recovery_enabled,
)


def _client():
    return boto3.client("dynamodb", **dynamo_client_kwargs())


def _resource():
    return boto3.resource("dynamodb", **dynamo_resource_kwargs())


def table_exists(client, table_name: str) -> bool:
    try:
        client.describe_table(TableName=table_name)
        return True
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ResourceNotFoundException":
            return False
        raise


def wait_active(client, table_name: str, timeout_s: float = 120.0) -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        resp = client.describe_table(TableName=table_name)
        status = resp["Table"]["TableStatus"]
        if status == "ACTIVE":
            return
        time.sleep(2.0)
    raise TimeoutError(f"Table {table_name} did not become ACTIVE within {timeout_s}s")


def enable_pitr(client, table_name: str) -> None:
    if not point_in_time_recovery_enabled():
        return
    try:
        client.update_continuous_backups(
            TableName=table_name,
            PointInTimeRecoverySpecification={"PointInTimeRecoveryEnabled": True},
        )
    except ClientError as exc:
        code = exc.response["Error"]["Code"]
        if code not in ("ContinuousBackupsUnavailableException",):
            raise


def enable_ttl(client, spec: TableSpec, table_name: str) -> None:
    if not spec.ttl_attribute:
        return
    try:
        desc = client.describe_time_to_live(TableName=table_name)
        status = desc.get("TimeToLiveDescription", {}).get("TimeToLiveStatus")
        if status == "ENABLED":
            return
        client.update_time_to_live(
            TableName=table_name,
            TimeToLiveSpecification={"Enabled": True, "AttributeName": spec.ttl_attribute},
        )
    except ClientError:
        pass


def create_table(spec: TableSpec, *, update_existing: bool = False) -> str:
    client = _client()
    name = physical_table_name(spec.logical_name)
    if table_exists(client, name):
        if not update_existing:
            enable_pitr(client, name)
            enable_ttl(client, spec, name)
            return f"exists:{name}"
        # Ensure PITR/TTL on existing tables; GSIs are only added at create time via CloudFormation/script re-run.
        enable_pitr(client, name)
        enable_ttl(client, spec, name)
        return f"verified:{name}"

    kwargs = boto_table_create_kwargs(spec)
    client.create_table(**kwargs)
    wait_active(client, name)
    enable_pitr(client, name)
    enable_ttl(client, spec, name)
    return f"created:{name}"


def verify_tables() -> list[str]:
    client = _client()
    missing: list[str] = []
    for spec in ALL_TABLES:
        name = physical_table_name(spec.logical_name)
        if not table_exists(client, name):
            missing.append(name)
    return missing


def seed_platform_catalog() -> dict[str, int]:
    """Seed subscription plans + platform org (same IDs as schema.sql). Mirrors Neon bootstrap rows."""
    from app.db.dynamo.key_patterns import iso_now, pk_org, pk_platform, row_to_item, sk_meta, sk_plan
    from app.db.dynamo.table_specs import MAIN_TABLE, physical_table_name

    table = _resource().Table(physical_table_name(MAIN_TABLE.logical_name))
    now = iso_now()
    plans = [
        {
            "id": "plan-free",
            "code": "free",
            "name": "Free",
            "description": "For solo recruiters trying HireRight",
            "price_cents_monthly": 0,
            "price_cents_yearly": 0,
            "limits": {"seats": 2, "active_jobs": 3, "interviews_per_month": 25, "vault_candidates": 50},
            "features": {"ai_interviews": True, "basic_analytics": True},
            "sort_order": 0,
        },
        {
            "id": "plan-starter",
            "code": "starter",
            "name": "Starter",
            "price_cents_monthly": 9900,
            "price_cents_yearly": 99000,
            "limits": {"seats": 5, "active_jobs": 15, "interviews_per_month": 200, "vault_candidates": 500},
            "features": {"ai_interviews": True, "shareable_job_links": True, "email_support": True},
            "sort_order": 1,
        },
        {
            "id": "plan-pro",
            "code": "pro",
            "name": "Professional",
            "price_cents_monthly": 29900,
            "price_cents_yearly": 299000,
            "limits": {"seats": 25, "active_jobs": 100, "interviews_per_month": 2000, "vault_candidates": 5000},
            "features": {
                "ai_interviews": True,
                "priority_support": True,
                "custom_branding": True,
                "api_access": True,
            },
            "sort_order": 2,
        },
        {
            "id": "plan-enterprise",
            "code": "enterprise",
            "name": "Enterprise",
            "price_cents_monthly": 0,
            "price_cents_yearly": 0,
            "limits": {
                "seats": 999,
                "active_jobs": 9999,
                "interviews_per_month": 99999,
                "vault_candidates": 99999,
            },
            "features": {"ai_interviews": True, "sso": True, "sla": True, "dedicated_csm": True},
            "sort_order": 3,
        },
    ]
    written = 0
    for plan in plans:
        item = row_to_item(
            pk=pk_platform(),
            sk=sk_plan(plan["id"]),
            entity_type="subscription_plan",
            data=plan,
            created_at=now,
            updated_at=now,
        )
        table.put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(pk) AND attribute_not_exists(sk)",
        )
        written += 1

    org_item = row_to_item(
        pk=pk_org("org-platform"),
        sk=sk_meta(),
        entity_type="organization",
        data={
            "id": "org-platform",
            "name": "HireRight Platform",
            "slug": "hireright-platform",
            "status": "active",
            "settings": {"is_platform": True},
        },
        gsi={"gsi1pk": "SLUG#hireright-platform", "gsi1sk": pk_org("org-platform")},
        created_at=now,
        updated_at=now,
    )
    try:
        table.put_item(
            Item=org_item,
            ConditionExpression="attribute_not_exists(pk) AND attribute_not_exists(sk)",
        )
        written += 1
    except ClientError as exc:
        if exc.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise

    sub_item = row_to_item(
        pk=pk_org("org-platform"),
        sk="ORG_SUBSCRIPTION",
        entity_type="organization_subscription",
        data={
            "id": "sub-platform",
            "organization_id": "org-platform",
            "plan_id": "plan-enterprise",
            "status": "active",
        },
        created_at=now,
        updated_at=now,
    )
    try:
        table.put_item(
            Item=sub_item,
            ConditionExpression="attribute_not_exists(pk) AND attribute_not_exists(sk)",
        )
        written += 1
    except ClientError as exc:
        if exc.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise

    return {"seeded": written}


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    verify_only = "--verify" in args
    seed = "--seed" in args

    if verify_only:
        missing = verify_tables()
        if missing:
            print("Missing DynamoDB tables:", ", ".join(missing), file=sys.stderr)
            return 1
        print(f"OK — {len(ALL_TABLES)} DynamoDB tables present.")
        return 0

    results: list[str] = []
    try:
        for spec in ALL_TABLES:
            results.append(create_table(spec))
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code == "AccessDeniedException":
            print(
                "DynamoDB AccessDenied — your IAM user needs dynamodb:CreateTable + DescribeTable.\n"
                "  Attach policy: infra/dynamodb/iam-hireright-dynamodb-policy.json (IAM → Users → Add permissions).\n"
                "  Then: npm run db:dynamo:init && npm run db:dynamo:seed",
                file=sys.stderr,
            )
            return 1
        raise
    print("DynamoDB:", ", ".join(results))

    if seed:
        stats = seed_platform_catalog()
        print(f"Seed: {stats['seeded']} platform items written (skipped if already present).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())