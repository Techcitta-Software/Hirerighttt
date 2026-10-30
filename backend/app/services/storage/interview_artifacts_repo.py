from __future__ import annotations

import uuid
from typing import Any


def _row(row: tuple) -> dict[str, Any]:
    cols = [
        "id",
        "tenant_id",
        "interview_id",
        "candidate_email",
        "artifact_type",
        "s3_object_key",
        "bucket",
        "content_type",
        "byte_size",
        "status",
    ]
    return dict(zip(cols, row[:10], strict=True))


def upsert_interview_artifact(pool, row: dict[str, Any]) -> str:
    rec_id = str(uuid.uuid4())
    with pool.connection() as conn:
        conn.execute(
            """INSERT INTO interview_artifacts (
              id, tenant_id, interview_id, candidate_email, artifact_type,
              s3_object_key, bucket, content_type, byte_size, status, created_at, updated_at
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'ready',NOW(),NOW())
            ON CONFLICT (interview_id, artifact_type) DO UPDATE SET
              s3_object_key = EXCLUDED.s3_object_key,
              bucket = EXCLUDED.bucket,
              content_type = EXCLUDED.content_type,
              byte_size = EXCLUDED.byte_size,
              status = 'ready',
              updated_at = NOW()""",
            (
                rec_id,
                row["tenantId"],
                row["interviewId"],
                str(row["candidateEmail"]).lower(),
                row["artifactType"],
                row["s3ObjectKey"],
                row.get("bucket"),
                row["contentType"],
                row.get("byteSize"),
            ),
        )
        conn.commit()
    return rec_id


def get_interview_artifact(pool, interview_id: str, artifact_type: str, active_bucket: str | None = None) -> dict | None:
    params: list[Any] = [interview_id, artifact_type]
    bucket_sql = ""
    if active_bucket:
        bucket_sql = " AND bucket = %s"
        params.append(active_bucket)
    with pool.connection() as conn:
        cur = conn.execute(
            f"""SELECT id, tenant_id, interview_id, candidate_email, artifact_type,
                       s3_object_key, bucket, content_type, byte_size, status
                FROM interview_artifacts
                WHERE interview_id = %s AND artifact_type = %s AND status = 'ready'{bucket_sql}""",
            tuple(params),
        )
        row = cur.fetchone()
    return _row(row) if row else None


def get_latest_interview_artifact_for_candidate(
    pool, candidate_email: str, artifact_type: str, active_bucket: str | None = None
) -> dict | None:
    params: list[Any] = [str(candidate_email or "").strip(), artifact_type]
    bucket_sql = ""
    if active_bucket:
        bucket_sql = " AND bucket = %s"
        params.append(active_bucket)
    with pool.connection() as conn:
        cur = conn.execute(
            f"""SELECT id, tenant_id, interview_id, candidate_email, artifact_type,
                       s3_object_key, bucket, content_type, byte_size, status
                FROM interview_artifacts
                WHERE lower(candidate_email) = lower(%s) AND artifact_type = %s AND status = 'ready'{bucket_sql}
                ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1""",
            tuple(params),
        )
        row = cur.fetchone()
    return _row(row) if row else None


def can_access_interview_artifact(requester_email: str, row: dict | None) -> bool:
    if not row or row.get("status") != "ready":
        return False
    return str(requester_email or "").lower() == str(row.get("candidate_email") or "").lower()
