from __future__ import annotations

import os
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError


def s3_storage_configured() -> bool:
    return bool(
        os.environ.get("S3_BUCKET")
        and os.environ.get("AWS_REGION")
        and os.environ.get("AWS_ACCESS_KEY_ID")
        and os.environ.get("AWS_SECRET_ACCESS_KEY")
    )


def object_storage_configured() -> bool:
    return s3_storage_configured()


def _client():
    return boto3.client(
        "s3",
        region_name=os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION"),
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID") or None,
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY") or None,
        config=Config(signature_version="s3v4"),
    )


def s3_env() -> dict[str, Any]:
    region = (os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "").strip()
    bucket = (os.environ.get("S3_BUCKET") or "").strip()
    presign = int(os.environ.get("S3_PRESIGN_EXPIRES_SECONDS") or 900)
    return {
        "region": region,
        "bucket": bucket,
        "presignSeconds": presign if presign > 0 else 900,
    }


def active_s3_bucket_name() -> str | None:
    bucket = s3_env()["bucket"]
    return bucket or None


def presign_download(
    key: str,
    *,
    disposition: str | None = None,
    content_type: str | None = None,
    expires: int | None = None,
) -> dict[str, Any]:
    bucket = os.environ["S3_BUCKET"]
    exp = s3_env()["presignSeconds"] if expires is None else expires
    params: dict[str, Any] = {"Bucket": bucket, "Key": key}
    if disposition:
        params["ResponseContentDisposition"] = disposition
    if content_type:
        params["ResponseContentType"] = content_type
    url = _client().generate_presigned_url("get_object", Params=params, ExpiresIn=exp)
    return {"url": url, "expiresInSeconds": exp}


def presign_upload(*, key: str, content_type: str, content_length: int | None = None) -> dict[str, Any]:
    del content_length
    bucket = os.environ["S3_BUCKET"]
    exp = s3_env()["presignSeconds"]
    url = _client().generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": key, "ContentType": content_type},
        ExpiresIn=exp,
    )
    return {"url": url, "expiresInSeconds": exp, "method": "PUT", "key": key}


def head_object(key: str) -> dict[str, Any] | None:
    bucket = os.environ.get("S3_BUCKET")
    if not bucket:
        return None
    try:
        return _client().head_object(Bucket=bucket, Key=key)
    except ClientError as err:
        code = err.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchKey", "NotFound"):
            return None
        raise


def delete_object(key: str) -> None:
    bucket = os.environ.get("S3_BUCKET")
    if bucket and key:
        _client().delete_object(Bucket=bucket, Key=key)


def upload_object(*, key: str, body: bytes, content_type: str) -> dict[str, str]:
    bucket = os.environ["S3_BUCKET"]
    _client().put_object(Bucket=bucket, Key=key, Body=body, ContentType=content_type, ServerSideEncryption="AES256")
    return {"bucket": bucket, "key": key}
