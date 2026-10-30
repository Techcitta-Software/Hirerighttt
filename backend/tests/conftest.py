from __future__ import annotations

import os
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient

# Import app after optional test env defaults (lifespan must not sys.exit).
os.environ.setdefault("ENVIRONMENT", "development")

from app.main import app  # noqa: E402


@pytest.fixture
def client() -> Generator[TestClient, None, None]:
    with TestClient(app) as test_client:
        yield test_client
