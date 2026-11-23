"""Paid interview retakes (Razorpay).

Routes
- GET  /api/payments/retake/status   (signed-in candidate) free interview left? credits? price? payments configured?
- POST /api/payments/retake/order    (signed-in candidate) create a Razorpay order for one retake
- POST /api/payments/retake/verify   (signed-in candidate) verify the Checkout signature and record the paid credit
"""

from __future__ import annotations

import asyncio
from typing import Callable

from fastapi import Request
from fastapi.responses import JSONResponse, Response
from psycopg.rows import dict_row

from app.db import store as db_store
from app.db.persistence import persistence_ready
from app.dispatch.context import DispatchContext
from app.node_config import config
from app.server import runtime
from app.services import retake_payments as rp

_PATHS = ("/api/payments/retake/status", "/api/payments/retake/order", "/api/payments/retake/verify")


def _db_ready() -> bool:
    return persistence_ready(config.database_url)


async def try_payment_routes(
    request: Request, ctx: DispatchContext, json_fn: Callable[..., JSONResponse]
) -> Response | None:
    path = request.url.path
    method = request.method.upper()
    if path not in _PATHS:
        return None
    email = await runtime.require_auth_email(request)
    if not _db_ready():
        return json_fn(503, {"error": "Payments need the database.", "code": "PAYMENTS_NOT_CONFIGURED"})
    pool = db_store.db_pool(config.database_url)

    def _with_conn(fn, *args):
        # Blocking database work runs in a worker thread, never on the event loop (P-02).
        def run():
            with pool.connection() as conn:
                conn.row_factory = dict_row
                out = fn(conn, *args)
                conn.commit()
                return out

        return asyncio.to_thread(run)

    def _conn_factory():
        conn_cm = pool.connection()

        class _Cm:
            def __enter__(self_inner):
                c = conn_cm.__enter__()
                c.row_factory = dict_row
                return c

            def __exit__(self_inner, *exc):
                return conn_cm.__exit__(*exc)

        return _Cm()

    try:
        if method == "GET" and path == "/api/payments/retake/status":
            return json_fn(200, await _with_conn(rp.retake_status, email))
        if method == "POST" and path == "/api/payments/retake/order":
            if not ctx.rate_limit(f"retake-order:{email}", 10, 60_000):
                return json_fn(429, {"error": "Too many payment attempts. Try again in a minute."})
            # The Razorpay call (up to 15 s) runs first; a connection is only taken for the INSERT afterwards.
            return json_fn(201, await rp.create_order(_conn_factory, email))
        if method == "POST" and path == "/api/payments/retake/verify":
            body = await runtime.read_json_body(request)
            out = await _with_conn(
                rp.verify_payment,
                email,
                str(body.get("razorpay_order_id") or "")[:100],
                str(body.get("razorpay_payment_id") or "")[:100],
                str(body.get("razorpay_signature") or "")[:200],
            )
            return json_fn(200, out)
    except rp.RetakePaymentError as err:
        return json_fn(err.status, {"error": str(err), "code": err.code})
    return json_fn(405, {"error": "Method not allowed."})
