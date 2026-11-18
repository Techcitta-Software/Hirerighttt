"""Paid interview retakes (Razorpay).

Routes
- GET  /api/payments/retake/status   (signed-in candidate) free interview left? credits? price? payments configured?
- POST /api/payments/retake/order    (signed-in candidate) create a Razorpay order for one retake
- POST /api/payments/retake/verify   (signed-in candidate) verify the Checkout signature and record the paid credit
"""

from __future__ import annotations

from typing import Callable

from fastapi import Request
from fastapi.responses import JSONResponse, Response
from psycopg.rows import dict_row

from app.db import store as db_store
from app.db.dynamo_config import database_provider, persistence_ready
from app.dispatch.context import DispatchContext
from app.node_config import config
from app.server import runtime
from app.services import retake_payments as rp

_PATHS = ("/api/payments/retake/status", "/api/payments/retake/order", "/api/payments/retake/verify")


def _db_ready() -> bool:
    return persistence_ready(config.database_url) and database_provider() != "dynamodb"


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
    try:
        if method == "GET" and path == "/api/payments/retake/status":
            with pool.connection() as conn:
                conn.row_factory = dict_row
                return json_fn(200, rp.retake_status(conn, email))
        if method == "POST" and path == "/api/payments/retake/order":
            if not ctx.rate_limit(f"retake-order:{email}", 10, 60_000):
                return json_fn(429, {"error": "Too many payment attempts. Try again in a minute."})
            with pool.connection() as conn:
                conn.row_factory = dict_row
                return json_fn(201, await rp.create_order(conn, email))
        if method == "POST" and path == "/api/payments/retake/verify":
            body = await runtime.read_json_body(request)
            with pool.connection() as conn:
                conn.row_factory = dict_row
                out = rp.verify_payment(
                    conn,
                    email,
                    str(body.get("razorpay_order_id") or ""),
                    str(body.get("razorpay_payment_id") or ""),
                    str(body.get("razorpay_signature") or ""),
                )
            return json_fn(200, out)
    except rp.RetakePaymentError as err:
        return json_fn(err.status, {"error": str(err), "code": err.code})
    return json_fn(405, {"error": "Method not allowed."})
