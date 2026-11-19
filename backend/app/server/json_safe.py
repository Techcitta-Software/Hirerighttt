"""Make API payloads JSON-serialisable (Postgres returns datetimes, UUIDs, Decimals and sets that json cannot encode)."""

from __future__ import annotations

from datetime import date, datetime, time
from decimal import Decimal
from uuid import UUID

# Exact types that need no conversion: checked first with one set lookup, because almost every value in a payload is
# one of these (the old isinstance chain cost ~70 ms on a 600 KB candidate list).
_PLAIN = frozenset({str, int, float, bool, type(None)})


def json_safe(value):
    t = type(value)
    if t in _PLAIN:
        return value
    if t is dict:
        return {(k if type(k) is str else str(k)): json_safe(v) for k, v in value.items()}
    if t is list:
        return [json_safe(v) for v in value]
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
