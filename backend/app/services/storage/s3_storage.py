from __future__ import annotations

import hashlib
import os
import threading
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError


def s3_storage_configured() -> bool:
    """A bucket and a region. Credentials come from the standard AWS chain: the ECS task role on AWS (no stored
    keys), or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY locally."""
    return bool(os.environ.get("S3_BUCKET") and (os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION")))


def object_storage_configured() -> bool:
    return s3_storage_configured()


# One S3 client per process. Building a client resolves credentials and opens a new TLS connection (0.5-1 s per call
# measured); boto3 clients are thread-safe, so the request handlers (which call these helpers via asyncio.to_thread)
# share it. Timeouts are explicit: botocore's defaults (60 s connect + 60 s read, legacy retries) could hold a request
# for minutes on a stuck connection.
_client_lock = threading.Lock()
_client_cache: dict[str, Any] = {"key": None, "client": None}


def _client_config() -> Config:
    return Config(
        signature_version="s3v4",
        connect_timeout=float(os.environ.get("S3_CONNECT_TIMEOUT_SECONDS") or 3),
        read_timeout=float(os.environ.get("S3_READ_TIMEOUT_SECONDS") or 30),
        retries={"max_attempts": int(os.environ.get("S3_MAX_ATTEMPTS") or 3), "mode": "adaptive"},
        max_pool_connections=int(os.environ.get("S3_MAX_POOL_CONNECTIONS") or 32),
    )


def _client():
    region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION")
    key_id = os.environ.get("AWS_ACCESS_KEY_ID") or None
    secret = os.environ.get("AWS_SECRET_ACCESS_KEY") or None
    # Rebuild only when the settings change (tests / local .env reloads); credentials are hashed, not stored.
    cache_key = (region, key_id, hashlib.sha256((secret or "").encode()).hexdigest())
    cached = _client_cache["client"]
    if cached is not None and _client_cache["key"] == cache_key:
        return cached
    with _client_lock:
        if _client_cache["client"] is None or _client_cache["key"] != cache_key:
            _client_cache["client"] = boto3.session.Session().client(
                "s3",
                region_name=region,
                aws_access_key_id=key_id,
                aws_secret_access_key=secret,
                config=_client_config(),
            )
            _client_cache["key"] = cache_key
        return _client_cache["client"]


def reset_client_cache() -> None:
    with _client_lock:
        _client_cache["client"] = None
        _client_cache["key"] = None


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
    """Presigned PUT bound to one exact size (V-09).

    Content-Length is part of the signature, so the browser can only upload exactly the number of bytes the server
    approved (already checked against the size limit). Without it a presigned URL accepted objects of any size."""
    if not content_length or int(content_length) <= 0:
        raise ValueError("content_length is required for a presigned upload")
    bucket = os.environ["S3_BUCKET"]
    exp = min(s3_env()["presignSeconds"], 900)
    url = _client().generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": key, "ContentType": content_type, "ContentLength": int(content_length)},
        ExpiresIn=exp,
    )
    return {
        "url": url,
        "expiresInSeconds": exp,
        "method": "PUT",
        "key": key,
        "headers": {"Content-Type": content_type, "Content-Length": str(int(content_length))},
    }


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


def upload_fileobj(*, key: str, fileobj: Any, content_type: str, tags: dict[str, str] | None = None) -> dict[str, str]:
    """Stream a (spooled) file to S3 without reading it into memory first (multipart for large files)."""
    from app.services.storage.s3_key_layout import assert_writable_user_object_key

    bucket = os.environ["S3_BUCKET"]
    expected = (os.environ.get("S3_EXPECTED_BUCKET") or "").strip()
    if expected and expected != bucket:
        raise RuntimeError(f'S3_BUCKET="{bucket}" does not match S3_EXPECTED_BUCKET="{expected}". Fix repo-root .env.')
    safe_key = assert_writable_user_object_key(key)
    extra: dict[str, Any] = {"ContentType": content_type, "ServerSideEncryption": "AES256"}
    if tags:
        extra["Tagging"] = "&".join(f"{k}={v}" for k, v in tags.items())
    _client().upload_fileobj(fileobj, bucket, safe_key, ExtraArgs=extra)
    return {"bucket": bucket, "key": safe_key}


def upload_object(*, key: str, body: bytes, content_type: str, tags: dict[str, str] | None = None) -> dict[str, str]:
    from app.services.storage.s3_key_layout import assert_writable_user_object_key

    bucket = os.environ["S3_BUCKET"]
    expected = (os.environ.get("S3_EXPECTED_BUCKET") or "").strip()
    if expected and expected != bucket:
        raise RuntimeError(
            f'S3_BUCKET="{bucket}" does not match S3_EXPECTED_BUCKET="{expected}". Fix repo-root .env.'
        )
    safe_key = assert_writable_user_object_key(key)
    params: dict[str, Any] = {
        "Bucket": bucket,
        "Key": safe_key,
        "Body": body,
        "ContentType": content_type,
        "ServerSideEncryption": "AES256",
    }
    if tags:
        params["Tagging"] = "&".join(f"{k}={v}" for k, v in tags.items())
    _client().put_object(**params)
    return {"bucket": bucket, "key": safe_key}
