"""Whether the API has a database to persist to (Postgres via DATABASE_URL)."""

from __future__ import annotations


def persistence_ready(database_url: str = "") -> bool:
    """True when DATABASE_URL is set, so auth and data routes can read and write."""
    return bool((database_url or "").strip())
