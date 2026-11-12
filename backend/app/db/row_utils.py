"""Helpers for database rows: the shared pool returns dict rows, but older code was written for tuples."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any


def row_to_named(row: Any, columns: Sequence[str]) -> dict[str, Any]:
    """Name a row's values, whether the driver gave us a dict (pool default) or a plain tuple."""
    if isinstance(row, Mapping):
        return {c: row.get(c) for c in columns}
    return dict(zip(columns, row, strict=False))


def row_value(row: Any, name: str, index: int) -> Any:
    """Read one column by name from a dict row, or by position from a tuple row."""
    if isinstance(row, Mapping):
        return row.get(name)
    return row[index]
