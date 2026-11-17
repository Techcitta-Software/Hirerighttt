"""DynamoDB client configuration.

When DATABASE_PROVIDER=dynamodb, the API does not use Neon at runtime (DATABASE_URL is optional;
keep it only for one-time `npm run db:dynamo:migrate`).
"""

from __future__ import annotations

import os
from typing import Any


def database_provider() -> str:
    """neon (default) | dynamodb | dual (migration: read Neon, write both)."""
    return (os.environ.get("DATABASE_PROVIDER") or "neon").strip().lower()


def use_dynamodb() -> bool:
    return database_provider() in ("dynamodb", "dual")


def use_neon() -> bool:
    return database_provider() in ("neon", "dual")


def persistence_ready(database_url: str = "") -> bool:
    """True when the API can read/write persisted data (DynamoDB-only or Neon URL set)."""
    if database_provider() == "dynamodb":
        return True
    return bool((database_url or "").strip())


def dynamo_endpoint_url() -> str | None:
    url = (os.environ.get("DYNAMODB_ENDPOINT_URL") or "").strip()
    return url or None


def dynamo_region() -> str:
    return (
        os.environ.get("AWS_REGION")
        or os.environ.get("AWS_DEFAULT_REGION")
        or "us-east-1"
    ).strip()


def dynamo_client_kwargs() -> dict[str, Any]:
    kw: dict[str, Any] = {"region_name": dynamo_region()}
    endpoint = dynamo_endpoint_url()
    if endpoint:
        kw["endpoint_url"] = endpoint
    return kw


def dynamo_resource_kwargs() -> dict[str, Any]:
    return dict(dynamo_client_kwargs())