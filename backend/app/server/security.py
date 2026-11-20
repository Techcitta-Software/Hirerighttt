"""Request-size limit (V-08) and security headers (V-12) as pure ASGI middleware.

Body limit
    MAX_REQUEST_BYTES (default 3 MB) for every request. A few routes legitimately carry files and get a larger
    allowance (see BODY_LIMIT_OVERRIDES). Requests that declare a bigger Content-Length are refused with 413 before
    any byte is read; chunked bodies (no Content-Length) are counted while they stream and cut off at the limit.

Security headers
    Added to every response unless the route set its own value. The JSON API never needs to be framed or sniffed,
    so the API's CSP is deny-all. The web pages get their CSP from CloudFront / nginx (infra/aws-free).
"""

from __future__ import annotations

import json
import os

from app.node_config import config, is_prod_like


def _recording_limit() -> int:
    try:
        rec = int(os.environ.get("S3_MAX_RECORDING_BYTES") or 104_857_600)
    except ValueError:
        rec = 104_857_600
    return rec + 1_048_576  # multipart framing + form fields


def _report_limit() -> int:
    try:
        rep = int(os.environ.get("S3_MAX_REPORT_BYTES") or 12_000_000)
    except ValueError:
        rep = 12_000_000
    return (rep * 4) // 3 + 65_536  # base64 in JSON


RESUME_BODY_LIMIT = 4_000_000  # 2 MB file as base64 (~2.7 MB) + extracted text + parsed fields


def body_limit_for(path: str) -> int:
    if path == "/api/interview/recordings/upload":
        return _recording_limit()
    if path == "/api/interview/artifacts/report":
        return _report_limit()
    if path in ("/api/resume/upload", "/api/resume/replace", "/api/resume/parse"):
        return max(config.max_body_bytes, RESUME_BODY_LIMIT)
    return config.max_body_bytes


async def _send_413(send) -> None:
    body = json.dumps({"error": "Request too large."}).encode()
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()),
                        (b"connection", b"close")],
        }
    )
    await send({"type": "http.response.body", "body": body})


class BodyLimitMiddleware:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or scope.get("method") in ("GET", "HEAD", "OPTIONS"):
            return await self.app(scope, receive, send)
        limit = body_limit_for(str(scope.get("path") or ""))
        declared = None
        for name, value in scope.get("headers") or []:
            if name == b"content-length":
                try:
                    declared = int(value)
                except ValueError:
                    return await _send_413(send)
                break
        if declared is not None and declared > limit:
            return await _send_413(send)

        received = 0
        started = False
        too_big = False

        async def limited_receive():
            nonlocal received, too_big
            if too_big:
                # Already cut off: anything that keeps reading (disconnect listeners) sees the client as gone,
                # instead of a second exception or a hang waiting for the rest of the body.
                return {"type": "http.disconnect"}
            message = await receive()
            if message.get("type") == "http.request":
                received += len(message.get("body") or b"")
                if received > limit:
                    too_big = True
                    raise _TooLarge()
            return message

        replaced = False

        async def tracking_send(message):
            nonlocal started, replaced
            if replaced:
                return  # body of the response we replaced with 413
            if message.get("type") == "http.response.start":
                started = True
                if too_big:
                    # A handler caught the cut-off as a generic parse error (e.g. "Invalid JSON"): answer 413.
                    replaced = True
                    await _send_413(send)
                    return
            await send(message)

        try:
            return await self.app(scope, limited_receive, tracking_send)
        except _TooLarge:
            if not started:
                return await _send_413(send)
            raise
        except Exception:
            # Starlette wraps errors raised while parsing the body; if our limit caused it, answer 413.
            if too_big and not started:
                return await _send_413(send)
            raise


class _TooLarge(Exception):
    pass


API_SECURITY_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"strict-origin-when-cross-origin"),
    (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
    (b"cross-origin-opener-policy", b"same-origin"),
    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"),
]
HSTS = (b"strict-transport-security", b"max-age=31536000; includeSubDomains")


class SecurityHeadersMiddleware:
    def __init__(self, app) -> None:
        self.app = app
        self.headers = list(API_SECURITY_HEADERS) + ([HSTS] if is_prod_like else [])

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)

        async def with_headers(message):
            if message.get("type") == "http.response.start":
                headers = list(message.get("headers") or [])
                present = {k.lower() for k, _ in headers}
                headers += [(k, v) for k, v in self.headers if k not in present]
                message = {**message, "headers": headers}
            await send(message)

        return await self.app(scope, receive, with_headers)
