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
# Tests never reach real S3, and tenant-scoped assertions assume the default "platform" tenant id —
# a QA shell exporting S3_DEFAULT_TENANT_ID=qa-... otherwise flips recording-access results.
# (Set to "" rather than popped: load_env() uses setdefault, so a popped key would be re-read from .env.)
for _k in ("S3_BUCKET", "S3_EXPECTED_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "PADDLE_OCR_URL"):
    os.environ[_k] = ""
os.environ.pop("S3_DEFAULT_TENANT_ID", None)
# Never send real email from tests, whatever the developer's shell or .env says.
# Never call a real LLM either: tests mock it (an unmocked call fails fast instead of spending quota).
for _k in ("SMTP_EMAIL", "SMTP_APP_PASSWORD", "RESEND_API_KEY", "GEMINI_API_KEY", "GEMINI_API_KEYS", "OPENROUTER_API_KEY"):
    os.environ[_k] = ""

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
