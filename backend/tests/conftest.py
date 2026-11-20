from __future__ import annotations

import os
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient

# ── Test isolation ────────────────────────────────────────────────────────────
# The app loads the repo-root .env, whose DATABASE_URL points at the real database. Tests must never touch it.
# They run against TEST_DATABASE_URL (a throwaway Postgres) or, when that is unset, with no database at all —
# the database-backed tests then skip themselves. This must run BEFORE `app.main` is imported.
_test_db = (os.environ.get("TEST_DATABASE_URL") or "").strip()
if _test_db and "neon.tech" in _test_db and os.environ.get("ALLOW_REMOTE_TEST_DB") != "1":
    raise RuntimeError(
        "TEST_DATABASE_URL points at a Neon (hosted) database. Use a throwaway Postgres, "
        "or set ALLOW_REMOTE_TEST_DB=1 if this really is a disposable test database."
    )
os.environ["DATABASE_URL"] = _test_db
os.environ["ENVIRONMENT"] = "development"
os.environ["NODE_ENV"] = "development"
os.environ.pop("REDIS_URL", None)  # the rate limiter uses its in-memory fallback in tests
os.environ.pop("SENTRY_DSN", None)

from app.main import app  # noqa: E402


@pytest.fixture
def client() -> Generator[TestClient, None, None]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session", autouse=True)
def _close_pools_at_exit():
    """A pool left open (e.g. to a fake URL) keeps reconnecting in background threads and the run never exits."""
    yield
    try:
        from app.db import store

        store.close_store()
    except Exception:
        pass
