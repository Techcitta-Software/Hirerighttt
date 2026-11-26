"""Uploads must not fail when the IAM principal lacks s3:PutObjectTagging (T5 B1: recording upload 500)."""

from __future__ import annotations

import io

import pytest
from boto3.exceptions import S3UploadFailedError
from botocore.exceptions import ClientError

from app.services.storage import s3_storage

KEY = "users/8dc467cc8b81d941/video/210c056d3e6b38b17eb3762b.webm"
DENIED = (
    "User: arn:aws:iam::1:user/x is not authorized to perform: s3:PutObjectTagging on resource: "
    f"arn:aws:s3:::bucket/{KEY}"
)


def _denied_client_error() -> ClientError:
    return ClientError({"Error": {"Code": "AccessDenied", "Message": DENIED}}, "PutObject")


class _FakeS3:
    def __init__(self, deny_tagging: bool = True):
        self.deny_tagging = deny_tagging
        self.calls: list[dict] = []

    def put_object(self, **params):
        self.calls.append(dict(params))
        if self.deny_tagging and "Tagging" in params:
            raise _denied_client_error()

    def upload_fileobj(self, fileobj, bucket, key, ExtraArgs=None):
        body = fileobj.read()
        self.calls.append({"Bucket": bucket, "Key": key, "Body": body, **(ExtraArgs or {})})
        if self.deny_tagging and "Tagging" in (ExtraArgs or {}):
            raise S3UploadFailedError(f"Failed to upload: An error occurred (AccessDenied) when calling the PutObject operation: {DENIED}")


@pytest.fixture
def fake_s3(monkeypatch):
    fake = _FakeS3()
    monkeypatch.setenv("S3_BUCKET", "bucket")
    monkeypatch.delenv("S3_EXPECTED_BUCKET", raising=False)
    monkeypatch.setattr(s3_storage, "_client", lambda: fake)
    monkeypatch.setitem(s3_storage._tagging_disabled, "value", False)
    return fake


def test_put_object_retries_without_tags_when_tagging_is_denied(fake_s3):
    out = s3_storage.upload_object(key=KEY, body=b"video", content_type="video/webm", tags={"retention": "days-30"})
    assert out["key"] == KEY
    assert len(fake_s3.calls) == 2
    assert "Tagging" in fake_s3.calls[0] and "Tagging" not in fake_s3.calls[1]
    # Later uploads skip the doomed tagged attempt.
    s3_storage.upload_object(key=KEY, body=b"video", content_type="video/webm", tags={"retention": "days-30"})
    assert len(fake_s3.calls) == 3 and "Tagging" not in fake_s3.calls[2]


def test_streamed_upload_rewinds_and_retries_without_tags(fake_s3):
    buf = io.BytesIO(b"0123456789")
    s3_storage.upload_fileobj(key=KEY, fileobj=buf, content_type="video/webm", tags={"retention": "days-30"})
    assert len(fake_s3.calls) == 2
    assert fake_s3.calls[1]["Body"] == b"0123456789"  # the retry sent the whole file again
    assert "Tagging" not in fake_s3.calls[1]


def test_other_access_denied_errors_still_raise(fake_s3, monkeypatch):
    class _Denied(_FakeS3):
        def put_object(self, **params):
            raise ClientError({"Error": {"Code": "AccessDenied", "Message": "not authorized to perform: s3:PutObject"}}, "PutObject")

    monkeypatch.setattr(s3_storage, "_client", lambda: _Denied())
    with pytest.raises(ClientError):
        s3_storage.upload_object(key=KEY, body=b"x", content_type="video/webm", tags={"retention": "days-30"})


def test_tagging_denied_detection():
    assert s3_storage.is_tagging_access_denied(_denied_client_error())
    assert not s3_storage.is_tagging_access_denied(ClientError({"Error": {"Code": "NoSuchBucket", "Message": "x"}}, "PutObject"))
