"""Migrations, audit log and retention against a real (throwaway) Postgres. Skipped without TEST_DATABASE_URL."""

from __future__ import annotations

import os

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not set")


@pytest.fixture
def app_pool():
    """The application's own pool (dict rows, same settings as production)."""
    from app.db import store as db_store
    from app.node_config import config

    object.__setattr__(config, "database_url", os.environ["TEST_DATABASE_URL"])
    db_store.close_store()
    yield db_store.db_pool(config.database_url)
    db_store.close_store()


@pytest.fixture(scope="module")
def conn():
    import psycopg

    from app.db.apply_schema import apply_schema

    with psycopg.connect(os.environ["TEST_DATABASE_URL"]) as c:
        apply_schema(c)
        c.commit()
        yield c


def test_migrations_apply_once_and_are_tamper_evident(conn, tmp_path, monkeypatch):
    from app.db import apply_schema as mod

    rows = conn.execute("SELECT version FROM schema_migrations ORDER BY version").fetchall()
    assert ("0001_audit_and_retention_indexes",) in rows
    assert mod.apply_migrations(conn) == []  # second run applies nothing

    fake = tmp_path / "migrations"
    fake.mkdir()
    (fake / "0001_audit_and_retention_indexes.sql").write_text("SELECT 1;", encoding="utf-8")  # edited!
    monkeypatch.setattr(mod, "MIGRATIONS_DIR", fake)
    with pytest.raises(RuntimeError, match="edited"):
        mod.apply_migrations(conn)
    conn.rollback()


def test_new_migration_is_picked_up(conn, tmp_path, monkeypatch):
    from app.db import apply_schema as mod

    fake = tmp_path / "migrations"
    fake.mkdir()
    for src in mod.migration_files():
        (fake / src.name).write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    (fake / "9999_test_only.sql").write_text("CREATE TABLE IF NOT EXISTS zz_migration_probe (id INT);", encoding="utf-8")
    monkeypatch.setattr(mod, "MIGRATIONS_DIR", fake)
    assert mod.apply_migrations(conn) == ["9999_test_only"]
    assert conn.execute("SELECT to_regclass('zz_migration_probe')").fetchone()[0] is not None
    conn.execute("DROP TABLE zz_migration_probe")
    conn.execute("DELETE FROM schema_migrations WHERE version = '9999_test_only'")
    conn.commit()


def test_audit_record_writes_a_row(conn, monkeypatch):
    from app.db import store as db_store
    from app.node_config import config
    from app.services import audit

    object.__setattr__(config, "database_url", os.environ["TEST_DATABASE_URL"])
    db_store.close_store()
    audit.record(audit.LOGIN_OK, entity_type="user", entity_id="probe-user", meta={"ip": "1.2.3.4"})
    row = conn.execute("SELECT action, meta->>'ip' FROM audit_logs WHERE entity_id = 'probe-user'").fetchone()
    assert row == ("auth.login", "1.2.3.4")
    conn.execute("DELETE FROM audit_logs WHERE entity_id = 'probe-user'")
    conn.commit()
    db_store.close_store()


def test_purge_removes_expired_credentials_but_keeps_live_ones(conn, app_pool):
    from app.services import retention

    conn.execute("DELETE FROM hireright_sessions")
    conn.execute("INSERT INTO hireright_sessions (token, email, expires_at) VALUES ('old','a@x.com', NOW() - INTERVAL '1 day')")
    conn.execute("INSERT INTO hireright_sessions (token, email, expires_at) VALUES ('live','b@x.com', NOW() + INTERVAL '1 day')")
    conn.execute(
        "INSERT INTO audit_logs (action, created_at) VALUES ('probe.ancient', NOW() - INTERVAL '5 years'), ('probe.recent', NOW())"
    )
    conn.commit()
    counts = retention.purge_expired(app_pool)
    assert counts["sessions"] == 1
    assert conn.execute("SELECT token FROM hireright_sessions").fetchall() == [("live",)]
    assert counts["audit_rows"] >= 1
    left = {r[0] for r in conn.execute("SELECT action FROM audit_logs WHERE action LIKE 'probe.%'").fetchall()}
    assert left == {"probe.recent"}
    conn.execute("DELETE FROM audit_logs WHERE action LIKE 'probe.%'")
    conn.execute("DELETE FROM hireright_sessions")
    conn.commit()


def test_media_retention_deletes_objects_then_rows(conn, app_pool, monkeypatch):
    from app.services import retention

    monkeypatch.setenv("RECORDING_RETENTION_DAYS", "30")

    conn.execute("DELETE FROM interview_recordings")
    for rid, age, key in (("r-old", 90, "users/u/video/old.webm"), ("r-new", 1, "users/u/video/new.webm")):
        conn.execute(
            """INSERT INTO interview_recordings (id, tenant_id, interview_id, candidate_email, s3_object_key,
                   original_filename, content_type, created_at)
               VALUES (%s,'t','i','c@x.com',%s,'f.webm','video/webm', NOW() - make_interval(days => %s))""",
            (rid, key, age),
        )
    conn.commit()
    deleted: list[str] = []
    counts = retention.purge_expired(app_pool, delete_object=deleted.append)
    assert deleted == ["users/u/video/old.webm"]
    assert counts["recordings"] == 1
    assert [r[0] for r in conn.execute("SELECT id FROM interview_recordings").fetchall()] == ["r-new"]

    # an S3 failure must keep the row so the file is retried, not orphaned
    conn.execute("UPDATE interview_recordings SET created_at = NOW() - INTERVAL '90 days'")
    conn.commit()

    def boom(_key: str) -> None:
        raise RuntimeError("s3 down")

    assert retention.purge_expired(app_pool, delete_object=boom)["recordings"] == 0
    assert conn.execute("SELECT count(*) FROM interview_recordings").fetchone()[0] == 1
    conn.execute("DELETE FROM interview_recordings")
    conn.commit()
