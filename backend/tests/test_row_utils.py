from __future__ import annotations

from app.db.row_utils import row_to_named, row_value
from app.services.storage import interview_artifacts_repo, interview_recordings_repo

REC_COLS = ["id", "tenant_id", "interview_id", "candidate_id", "candidate_email", "s3_object_key", "bucket",
            "original_filename", "content_type", "file_size_bytes", "duration_seconds", "status", "created_at", "updated_at"]


def test_dict_rows_keep_their_real_values_not_column_names():
    """Regression: zip(cols, dict_row) used to return {'tenant_id': 'tenant_id', ...} (the dict's KEYS)."""
    row = {c: f"value-of-{c}" for c in REC_COLS}
    row["tenant_id"] = "org-1"
    row["status"] = "uploaded"
    out = interview_recordings_repo._row_to_dict(row)
    assert out["tenant_id"] == "org-1" and out["status"] == "uploaded"
    assert out["s3_object_key"] == "value-of-s3_object_key"  # a value, not the literal column name


def test_tuple_rows_still_work():
    out = row_to_named(tuple(f"v{i}" for i in range(3)), ["a", "b", "c"])
    assert out == {"a": "v0", "b": "v1", "c": "v2"}


def test_artifact_dict_rows_work_even_with_extra_columns():
    cols = ["id", "tenant_id", "interview_id", "candidate_email", "artifact_type", "s3_object_key", "bucket",
            "content_type", "byte_size", "status"]
    row = {c: c.upper() for c in cols}
    row["extra_column"] = "ignored"
    out = interview_artifacts_repo._row(row)
    assert out["artifact_type"] == "ARTIFACT_TYPE" and "extra_column" not in out


def test_row_value_by_name_or_position():
    assert row_value({"email": "a@b.c", "data": {"x": 1}}, "email", 0) == "a@b.c"
    assert row_value(("a@b.c", {"x": 1}), "data", 1) == {"x": 1}
