"""published_at is stamped in SQL the first time a job is active or published."""

from app.db.store import JOB_PUBLISHED_AT_UPDATE, job_upsert_sql


def test_publish_sql_sets_published_at_once():
    sql = job_upsert_sql()
    assert JOB_PUBLISHED_AT_UPDATE in sql
    assert "COALESCE(jobs.published_at, NOW())" in sql
    assert "EXCLUDED.status IN ('active', 'published')" in sql
    assert "CASE WHEN %s IN ('active', 'published') THEN NOW() ELSE NULL END" in sql
    # Closing or unpublishing keeps the original timestamp.
    assert "ELSE jobs.published_at END" in sql
