"""T3: POST /api/vendor/applicants/{id}/interview-invite twice at once made two invites. The insert is now
serialised per application (advisory lock) and returns the existing invite. Needs a throwaway Postgres; skipped
without TEST_DATABASE_URL. Also covers the maintenance sweep of abandoned / never-entered interview sessions."""

from __future__ import annotations

import json
import os
import secrets
import threading
from datetime import datetime, timedelta, timezone

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not set")


@pytest.fixture
def pool():
    from app.db import store as db_store
    from app.node_config import config

    original = config.database_url
    object.__setattr__(config, "database_url", os.environ["TEST_DATABASE_URL"])
    db_store.close_store()
    db_store._ensure_schema(config.database_url)
    yield db_store.db_pool(config.database_url)
    db_store.close_store()
    object.__setattr__(config, "database_url", original)


def test_concurrent_applicant_invites_create_one_invite(pool):
    from app.services.interview_invites import _insert_invite_once_sync

    app_id = f"app-{secrets.token_hex(4)}"
    start = (datetime.now(timezone.utc) + timedelta(days=1)).replace(microsecond=0)
    results: list[tuple[str, bool]] = []
    barrier = threading.Barrier(6)

    def send(_i):
        barrier.wait()
        results.append(
            _insert_invite_once_sync(
                pool,
                {
                    "token": secrets.token_hex(24),
                    "applicationId": app_id,
                    "candidateEmail": "dup@test.local",
                    "scheduledStart": start.isoformat(),
                    "scheduledEnd": (start + timedelta(minutes=15)).isoformat(),
                },
            )
        )

    threads = [threading.Thread(target=send, args=(i,)) for i in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert [created for _t, created in results].count(True) == 1
    assert len({tok for tok, _c in results}) == 1
    with pool.connection() as conn:
        rows = conn.execute("SELECT COUNT(*) AS n FROM interview_invites WHERE application_id = %s", (app_id,)).fetchone()
    assert (rows["n"] if isinstance(rows, dict) else rows[0]) == 1


def test_maintenance_sweep_abandons_stale_and_drops_unused_sessions(pool):
    from app.services import interview_session_lifecycle as ivlife

    stale, unused, live = (f"s-{secrets.token_hex(6)}" for _ in range(3))
    with pool.connection() as conn:
        for sid, status, age in ((stale, "active", "7 hours"), (unused, "pending", "2 days"), (live, "active", "1 hour")):
            conn.execute(
                "INSERT INTO interview_sessions (session_id, email, data, updated_at) VALUES (%s, %s, %s::jsonb, NOW() - %s::interval)",
                (sid, "sweep@test.local", json.dumps({"status": status}), age),
            )
        conn.commit()
        ivlife.sweep_sessions_sql(conn)
        conn.commit()
        got = {
            (r["session_id"] if isinstance(r, dict) else r[0]): (r["data"] if isinstance(r, dict) else r[1])
            for r in conn.execute(
                "SELECT session_id, data FROM interview_sessions WHERE session_id = ANY(%s)", ([stale, unused, live],)
            ).fetchall()
        }
    assert got[stale]["status"] == "abandoned" and got[stale]["abandonedAt"]
    assert unused not in got
    assert got[live]["status"] == "active"
