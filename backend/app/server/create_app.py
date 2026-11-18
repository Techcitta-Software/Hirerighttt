from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from datetime import date, datetime
from uuid import UUID

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.dispatch.api_dispatch import build_dispatch_context, handle_api_dispatch
from app.node_config import assert_production_config, config, is_prod_like
from app.routes.auth_node import router as auth_node_router
from app.routes.health_node import router as health_node_router
from app.routes.meta_node import router as meta_node_router
from app.routes.tts_node import router as tts_node_router
from app.server import observability, runtime
from app.assessment.contracts import AssessmentError
from app.assessment.personalized import handle_personalized, wants_personalized
from app.assessment.service import handle as handle_assessment
from app.server.json_safe import json_safe

logger = logging.getLogger("hireright.api")


NATIVE_API_EXACT = frozenset(
    {
        "/api/health",
        "/api/health/live",
        "/api/signup",
        "/api/login",
        "/api/logout",
        "/api/password/forgot",
        "/api/password/reset",
        "/api/me",
        "/api/profile",
        "/api/llm-status",
        "/api/mail/status",
        "/api/organization",
        "/api/plans",
        "/api/interview/tts",
        "/api/interview/tts/status",
    }
)


def _use_native_handler(path: str) -> bool:
    return path in NATIVE_API_EXACT


@asynccontextmanager
async def lifespan(_: FastAPI):
    assert_production_config()
    from app.db.dynamo_config import database_provider

    if database_provider() == "dynamodb" or config.database_url.strip():
        await asyncio.to_thread(runtime.load_db_sync)
    yield
    # Close the Postgres pool while the interpreter is still running. Left to garbage collection it logged a
    # "PythonFinalizationError: cannot join thread at interpreter shutdown" traceback on every stop / reload.
    try:
        from app.services.gemini_client import close_shared_http_client

        await close_shared_http_client()
    except Exception:
        logger.warning("Could not close the Gemini HTTP client cleanly", exc_info=True)
    try:
        from app.db import close_store

        await asyncio.to_thread(close_store)
    except Exception:
        logger.warning("Could not close the database pool cleanly", exc_info=True)


def create_app() -> FastAPI:
    observability.configure_logging(json_logs=is_prod_like)
    observability.init_sentry(config.environment)
    app = FastAPI(title="HireRight API", lifespan=lifespan)

    allow_origins = config.cors_origins if is_prod_like else list(
        dict.fromkeys([*config.cors_origins, "http://localhost:5173", "http://127.0.0.1:5173"])
    )
    app.include_router(health_node_router, prefix="/api")
    app.include_router(auth_node_router, prefix="/api")
    app.include_router(meta_node_router, prefix="/api")
    app.include_router(tts_node_router, prefix="/api")

    @app.get("/api/health/live", include_in_schema=False)
    async def live() -> dict[str, bool]:
        return {"ok": True}

    dispatch_ctx = build_dispatch_context()

    @app.middleware("http")
    async def python_api_dispatch(request: Request, call_next):
        path = request.url.path
        if request.method == "OPTIONS":
            # Preflights are answered by CORSMiddleware, which wraps this middleware (see below).
            return await call_next(request)
        if path.startswith("/api") and not _use_native_handler(path):
            try:
                # The emailed invite landing page is opened BEFORE the candidate signs in, so it is not auth-gated here.
                is_public_invite_lookup = request.method == "GET" and path.startswith("/api/interview-invites/")
                if not is_public_invite_lookup and (
                    path.startswith("/api/assessments") or path.startswith("/api/interview")
                ):
                    try:
                        email = await runtime.require_auth_email(request)
                        content_type = (request.headers.get("content-type") or "").lower()
                        body = {}
                        if request.method != "GET" and "application/json" in content_type:
                            body = await runtime.read_json_body(request)
                        if path.startswith("/api/assessments"):
                            status, payload = await handle_assessment(
                                request.method.upper(),
                                path,
                                email,
                                body,
                                dict(request.query_params),
                            )
                            return JSONResponse(status_code=status, content=json_safe(payload))
                        if wants_personalized(path, request.method.upper(), body):
                            payload = await handle_personalized(path, request.method.upper(), email, body)
                            return JSONResponse(status_code=200, content=json_safe(payload))
                    except HTTPException as err:
                        detail = err.detail if isinstance(err.detail, str) else "Unauthorized"
                        return JSONResponse(status_code=err.status_code, content={"error": detail})
                    except AssessmentError as err:
                        return JSONResponse(status_code=err.status, content={"error": str(err)})
                handled = await handle_api_dispatch(request, dispatch_ctx)
                if handled is not None:
                    return handled
                return JSONResponse(status_code=404, content={"error": "Not found"})
            except HTTPException as err:
                # Auth / permission errors raised inside route handlers must stay 401/403, not become a 500.
                detail = err.detail if isinstance(err.detail, str) else "Request failed."
                return JSONResponse(status_code=err.status_code, content={"error": detail})
            except Exception as exc:
                logger.exception("API dispatch failed for %s", path)
                observability.capture_exception(exc)
                return JSONResponse(status_code=500, content={"error": "Server error"})
        return await call_next(request)

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        rid = observability.new_request_id(request.headers.get("x-request-id"))
        token = observability.request_id_var.set(rid)
        started = time.perf_counter()
        try:
            response = await call_next(request)
            response.headers["X-Request-ID"] = rid
            if request.url.path.startswith("/api") and request.url.path not in ("/api/health", "/api/health/live"):
                logger.info(
                    "%s %s -> %s in %dms",
                    request.method,
                    request.url.path,
                    response.status_code,
                    (time.perf_counter() - started) * 1000,
                )
            return response
        finally:
            observability.request_id_var.reset(token)

    # Registered LAST so it is the OUTERMOST middleware: every response — including the ones the
    # dispatch middleware above returns directly for /api/vendor/*, /api/interview/* … — gets the
    # Access-Control-Allow-* headers. Registered first, only native routes got them and browsers
    # blocked the rest whenever the frontend and API are on different origins (Vercel → Render).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        expose_headers=["X-Request-ID"],
    )
    # Outermost of all: each HTTP request gets its own unit of work (app/db/uow.py), so the routes below only load
    # the rows they touch and nothing is shared between requests or API instances.
    from app.db.uow import UnitOfWorkMiddleware

    app.add_middleware(UnitOfWorkMiddleware, database_url_fn=lambda: config.database_url)

    @app.get("/", include_in_schema=False)
    async def root() -> dict[str, str]:
        return {"service": "hireright-api", "runtime": "python", "health": "/api/health"}

    return app
