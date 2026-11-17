"""Error tracking, structured logs and request ids.

* SENTRY_DSN set  -> unhandled errors are reported to Sentry (no PII, no request bodies).
* Production-like -> logs are one JSON object per line, ready for Render / Datadog / Loki.
* Every request gets an `X-Request-ID` (honouring one sent by the proxy) that appears in its log lines, so a
  user-reported error can be matched to a server log.
"""

from __future__ import annotations

import contextvars
import json
import logging
import os
import sys
import time
import uuid
from typing import Any

logger = logging.getLogger("hireright.api")

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)) + f".{int(record.msecs):03d}Z",
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": request_id_var.get(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(*, json_logs: bool) -> None:
    root = logging.getLogger()
    level = getattr(logging, (os.environ.get("LOG_LEVEL") or "INFO").upper(), logging.INFO)
    root.setLevel(level)
    if not json_logs:
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root.handlers[:] = [handler]


def init_sentry(environment: str) -> bool:
    dsn = (os.environ.get("SENTRY_DSN") or "").strip()
    if not dsn:
        return False
    try:
        import sentry_sdk
    except ImportError:
        logger.warning("SENTRY_DSN is set but sentry-sdk is not installed; error tracking is off")
        return False
    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        release=os.environ.get("API_BUILD_ID") or None,
        traces_sample_rate=float(os.environ.get("SENTRY_TRACES_SAMPLE_RATE") or 0.0),
        send_default_pii=False,  # candidate emails, résumés and answers must never leave through error reports
        max_request_body_size="never",
    )
    logger.info("Sentry error tracking enabled (%s)", environment)
    return True


def capture_exception(exc: BaseException) -> None:
    """Report a handled-but-unexpected error (the dispatch layer turns them into 500s, which Sentry would not see)."""
    try:
        import sentry_sdk

        sentry_sdk.capture_exception(exc)
    except Exception:
        pass


def new_request_id(incoming: str | None) -> str:
    candidate = (incoming or "").strip()
    if 8 <= len(candidate) <= 64 and all(c.isalnum() or c in "-_" for c in candidate):
        return candidate
    return uuid.uuid4().hex
