"""
Production DynamoDB table definitions for HireRight.

Neon Postgres remains the default runtime store (DATABASE_PROVIDER=neon).
These tables sit alongside Neon — nothing here drops or replaces DATABASE_URL.

Design: two tables (minimal surface area, full entity coverage via single-table keys).
  - {prefix}-{env}-main   — all domain entities (users, orgs, jobs, interviews, files meta, assessments, …)
  - {prefix}-{env}-audit  — append-only audit_logs + assessment_events (TTL-friendly)

See neon_entity_map.md for PK/SK patterns per legacy Postgres table.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Literal

BillingMode = Literal["PAY_PER_REQUEST", "PROVISIONED"]


@dataclass(frozen=True)
class GsiSpec:
    index_name: str
    partition_key: str
    sort_key: str
    projection: Literal["ALL", "KEYS_ONLY"] = "ALL"


@dataclass(frozen=True)
class TableSpec:
    logical_name: str
    partition_key: str = "pk"
    sort_key: str = "sk"
    gsis: tuple[GsiSpec, ...] = ()
    stream_enabled: bool = False
    ttl_attribute: str | None = "ttl"


def table_prefix() -> str:
    return (os.environ.get("DYNAMODB_TABLE_PREFIX") or "hireright").strip().rstrip("-") or "hireright"


def table_env() -> str:
    raw = (
        os.environ.get("DYNAMODB_ENV")
        or os.environ.get("ENVIRONMENT")
        or os.environ.get("NODE_ENV")
        or "dev"
    ).strip().lower()
    if raw in ("production", "prod"):
        return "prod"
    if raw in ("staging", "stage"):
        return "staging"
    return "dev" if raw == "development" else raw


def physical_table_name(logical_name: str) -> str:
    """Exact name override: DYNAMODB_MAIN_TABLE / DYNAMODB_AUDIT_TABLE (console-created names)."""
    if logical_name == "main":
        override = (os.environ.get("DYNAMODB_MAIN_TABLE") or "").strip()
        if override:
            return override
    if logical_name == "audit":
        override = (os.environ.get("DYNAMODB_AUDIT_TABLE") or "").strip()
        if override:
            return override
    return f"{table_prefix()}-{table_env()}-{logical_name}"


MAIN_GSIS: tuple[GsiSpec, ...] = (
    GsiSpec("Gsi1", "gsi1pk", "gsi1sk"),
    GsiSpec("Gsi2", "gsi2pk", "gsi2sk"),
    GsiSpec("Gsi3", "gsi3pk", "gsi3sk"),
    GsiSpec("Gsi4", "gsi4pk", "gsi4sk"),
)

MAIN_TABLE = TableSpec(
    logical_name="main",
    gsis=MAIN_GSIS,
    stream_enabled=True,
    ttl_attribute="ttl",
)

AUDIT_TABLE = TableSpec(
    logical_name="audit",
    gsis=(GsiSpec("Gsi1", "gsi1pk", "gsi1sk"),),
    stream_enabled=False,
    ttl_attribute="ttl",
)

ALL_TABLES: tuple[TableSpec, ...] = (MAIN_TABLE, AUDIT_TABLE)


def billing_mode() -> BillingMode:
    raw = (os.environ.get("DYNAMODB_BILLING_MODE") or "PAY_PER_REQUEST").strip().upper()
    if raw in ("ON_DEMAND", "PAY_PER_REQUEST"):
        return "PAY_PER_REQUEST"
    return "PROVISIONED"


def deletion_protection_enabled() -> bool:
    if os.environ.get("DYNAMODB_DELETION_PROTECTION", "").strip().lower() in ("1", "true", "yes"):
        return True
    env = table_env()
    return env in ("prod", "staging")


def point_in_time_recovery_enabled() -> bool:
    val = os.environ.get("DYNAMODB_ENABLE_PITR", "").strip().lower()
    if val in ("0", "false", "no"):
        return False
    if val in ("1", "true", "yes"):
        return True
    return table_env() in ("prod", "staging")


def boto_table_create_kwargs(spec: TableSpec) -> dict[str, Any]:
    attr_names = {spec.partition_key, spec.sort_key}
    for gsi in spec.gsis:
        attr_names.add(gsi.partition_key)
        attr_names.add(gsi.sort_key)

    attribute_definitions = [{"AttributeName": name, "AttributeType": "S"} for name in sorted(attr_names)]

    key_schema = [
        {"AttributeName": spec.partition_key, "KeyType": "HASH"},
        {"AttributeName": spec.sort_key, "KeyType": "RANGE"},
    ]

    global_secondary_indexes = []
    for gsi in spec.gsis:
        global_secondary_indexes.append(
            {
                "IndexName": gsi.index_name,
                "KeySchema": [
                    {"AttributeName": gsi.partition_key, "KeyType": "HASH"},
                    {"AttributeName": gsi.sort_key, "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": gsi.projection},
            }
        )

    billing = billing_mode()
    table_kw: dict[str, Any] = {
        "TableName": physical_table_name(spec.logical_name),
        "AttributeDefinitions": attribute_definitions,
        "KeySchema": key_schema,
        "BillingMode": billing,
        "DeletionProtectionEnabled": deletion_protection_enabled(),
    }

    if billing == "PROVISIONED":
        read = int(os.environ.get("DYNAMODB_PROVISIONED_READ", "5"))
        write = int(os.environ.get("DYNAMODB_PROVISIONED_WRITE", "5"))
        table_kw["ProvisionedThroughput"] = {"ReadCapacityUnits": read, "WriteCapacityUnits": write}
        for gsi_def in global_secondary_indexes:
            gsi_def["ProvisionedThroughput"] = {"ReadCapacityUnits": read, "WriteCapacityUnits": write}

    if global_secondary_indexes:
        table_kw["GlobalSecondaryIndexes"] = global_secondary_indexes

    sse = (os.environ.get("DYNAMODB_SSE") or "AWS").strip().upper()
    if sse == "KMS":
        kms_key = (os.environ.get("DYNAMODB_KMS_KEY_ID") or "").strip()
        if kms_key:
            table_kw["SSESpecification"] = {
                "Enabled": True,
                "SSEType": "KMS",
                "KMSMasterKeyId": kms_key,
            }
    elif sse not in ("OFF", "NONE", "0", "FALSE"):
        # Default SSE at rest (AWS owned key) — do not pass SSEType; AES256 is not valid on CreateTable.
        table_kw["SSESpecification"] = {"Enabled": True}

    if spec.stream_enabled:
        table_kw["StreamSpecification"] = {"StreamEnabled": True, "StreamViewType": "NEW_AND_OLD_IMAGES"}

    tags = []
    for key in ("DYNAMODB_TAG_PROJECT", "DYNAMODB_TAG_OWNER"):
        val = os.environ.get(key, "").strip()
        if val:
            tags.append({"Key": key.replace("DYNAMODB_TAG_", "").lower(), "Value": val})
    if os.environ.get("DYNAMODB_CREATE_TAGS", "").strip().lower() in ("1", "true", "yes"):
        tags.extend(
            [
                {"Key": "application", "Value": "hireright"},
                {"Key": "env", "Value": table_env()},
                {"Key": "data-store", "Value": spec.logical_name},
            ]
        )
        if tags:
            table_kw["Tags"] = tags

    return table_kw