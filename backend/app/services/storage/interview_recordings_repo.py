from __future__ import annotations

import uuid
from typing import Any


def _row_to_dict(row: tuple) -> dict[str, Any]:
    cols = [
        "id",
        "tenant_id",
        "interview_id",
        "candidate_id",
        "candidate_email",
        "s3_object_key",
        "bucket",
        "original_filename",
        "content_type",
        "file_size_bytes",
        "duration_seconds",
        "status",
        "created_at",
        "updated_at",
    ]
    return dict(zip(cols, row, strict=True))


def insert_interview_recording(pool, row: dict[str, Any]) -> str:
    rec_id = str(uuid.uuid4())
    status = row.get("status") or "pending"
    with pool.connection() as conn:
        conn.execute(
            """INSERT INTO interview_recordings (
              id, tenant_id, interview_id, candidate_id, candidate_email,
              s3_object_key, bucket, original_filename, content_type,
              file_size_bytes, duration_seconds, status, created_at, updated_at
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW())""",
            (
                rec_id,
                row["tenantId"],
                row["interviewId"],
                row.get("candidateId"),
                str(row["candidateEmail"]).lower(),
                row["s3ObjectKey"],
                row.get("bucket"),
                row["originalFilename"],
                row["contentType"],
                row.get("fileSizeBytes"),
                row.get("durationSeconds"),
                status,
            ),
        )
        conn.commit()
    return rec_id


def get_interview_recording_by_id(pool, rec_id: str) -> dict[str, Any] | None:
    with pool.connection() as conn:
        cur = conn.execute(
            """SELECT id, tenant_id, interview_id, candidate_id, candidate_email,
                      s3_object_key, bucket, original_filename, content_type,
                      file_size_bytes, duration_seconds, status, created_at, updated_at
               FROM interview_recordings WHERE id = %s""",
            (rec_id,),
        )
        row = cur.fetchone()
    return _row_to_dict(row) if row else None


def update_interview_recording(pool, rec_id: str, patch: dict[str, Any]) -> None:
    sets: list[str] = []
    vals: list[Any] = []
    if patch.get("status"):
        sets.append("status = %s")
        vals.append(patch["status"])
    if patch.get("fileSizeBytes") is not None:
        sets.append("file_size_bytes = %s")
        vals.append(patch["fileSizeBytes"])
    if patch.get("durationSeconds") is not None:
        sets.append("duration_seconds = %s")
        vals.append(patch["durationSeconds"])
    if not sets:
        return
    sets.append("updated_at = NOW()")
    vals.append(rec_id)
    with pool.connection() as conn:
        conn.execute(f"UPDATE interview_recordings SET {', '.join(sets)} WHERE id = %s", vals)
        conn.commit()


def get_interview_recording_for_session(
    pool,
    interview_id: str,
    candidate_email: str,
    active_bucket: str | None = None,
) -> dict[str, Any] | None:
    iid = str(interview_id or "").strip()
    email = str(candidate_email or "").strip().lower()
    if not iid or not email:
        return None
    params: list[Any] = [iid, email]
    bucket_sql = ""
    if active_bucket:
        bucket_sql = " AND bucket = %s"
        params.append(active_bucket)
    with pool.connection() as conn:
        cur = conn.execute(
            f"""SELECT id, tenant_id, interview_id, candidate_id, candidate_email,
                       s3_object_key, bucket, original_filename, content_type,
                       file_size_bytes, duration_seconds, status, created_at, updated_at
                FROM interview_recordings
                WHERE interview_id = %s AND lower(candidate_email) = %s
                  AND status IN ('uploaded', 'completed'){bucket_sql}
                ORDER BY created_at DESC LIMIT 1""",
            tuple(params),
        )
        row = cur.fetchone()
    return _row_to_dict(row) if row else None


def get_latest_interview_recording_for_candidate(pool, candidate_email: str, active_bucket: str | None = None) -> dict | None:
    email = str(candidate_email or "").strip().lower()
    if not email:
        return None
    params: list[Any] = [email]
    bucket_sql = ""
    if active_bucket:
        bucket_sql = " AND bucket = %s"
        params.append(active_bucket)
    with pool.connection() as conn:
        cur = conn.execute(
            f"""SELECT id, tenant_id, interview_id, candidate_id, candidate_email,
                       s3_object_key, bucket, original_filename, content_type,
                       file_size_bytes, duration_seconds, status, created_at, updated_at
                FROM interview_recordings
                WHERE lower(candidate_email) = %s
                  AND status IN ('uploaded', 'completed'){bucket_sql}
                ORDER BY created_at DESC LIMIT 1""",
            tuple(params),
        )
        row = cur.fetchone()
    return _row_to_dict(row) if row else None


def can_access_interview_recording(requester_email: str, row: dict | None) -> bool:
    if not row or row.get("status") == "deleted":
        return False
    return str(requester_email or "").lower() == str(row.get("candidate_email") or "").lower()
