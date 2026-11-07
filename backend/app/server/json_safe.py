"""Make API payloads JSON-serialisable (Postgres returns datetimes, UUIDs, Decimals and sets that json cannot encode)."""

from __future__ import annotations

from datetime import date, datetime, time
from decimal import Decimal
from uuid import UUID


def json_safe(value):
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [json_safe(v) for v in value]
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Decimal):
        return float(value) if value % 1 else int(value)
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8", "replace")
    return value
