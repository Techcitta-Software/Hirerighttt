"""Paid interview retakes with Razorpay.

Rules
- The first career (practice) interview is free.
- Every further career interview needs one paid retake credit (₹89 by default), consumed when that interview starts.
- Interviews for a vendor's job (application / job / invite) are never charged.

Flow (Razorpay Standard Checkout)
1. POST /api/payments/retake/order  -> the server creates a Razorpay order for the fixed price (the client never sets it).
2. The browser opens Razorpay Checkout with that order id and the public key id.
3. POST /api/payments/retake/verify -> the server checks HMAC-SHA256(order_id|payment_id) with the key secret and only
   then records the credit as paid. A forged or replayed callback cannot create a credit.

Config: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET (test keys start with rzp_test_), RETAKE_PRICE_INR (default 89).
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import secrets
from typing import Any

logger = logging.getLogger("hireright.payments")

RAZORPAY_API = "https://api.razorpay.com/v1"


class RetakePaymentError(Exception):
    def __init__(self, status: int, message: str, code: str = "RETAKE_PAYMENT_ERROR") -> None:
        super().__init__(message)
        self.status = status
        self.code = code


def retake_price_inr() -> int:
    try:
        return max(1, int(os.environ.get("RETAKE_PRICE_INR") or 89))
    except ValueError:
        return 89


def razorpay_key_id() -> str:
    return (os.environ.get("RAZORPAY_KEY_ID") or "").strip()


def _razorpay_secret() -> str:
    return (os.environ.get("RAZORPAY_KEY_SECRET") or "").strip()


def payments_configured() -> bool:
    return bool(razorpay_key_id() and _razorpay_secret())


def is_job_interview(body: dict[str, Any] | None, session: dict[str, Any] | None = None) -> bool:
    """A vendor's job interview (never charged)."""
    for src in (body or {}, session or {}):
        if src.get("applicationId") or src.get("jobId") or src.get("inviteToken"):
            return True
    return False


def valid_signature(order_id: str, payment_id: str, signature: str, secret: str | None = None) -> bool:
    secret = secret if secret is not None else _razorpay_secret()
    if not (order_id and payment_id and signature and secret):
        return False
    expected = hmac.new(secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature.strip())


# ---------------------------------------------------------------------------------------------------------------
# Database (Postgres). `conn` is a psycopg connection with dict_row.


def completed_career_interviews(conn, email: str) -> int:
    row = conn.execute(
        """SELECT COUNT(*) AS n FROM interview_sessions
           WHERE lower(email) = lower(%s)
             AND data->>'status' = 'completed'
             AND COALESCE(data->>'applicationId', '') = ''
             AND COALESCE(data->>'jobId', '') = ''
             AND COALESCE(data->>'inviteToken', '') = ''""",
        (email,),
    ).fetchone()
    return int((row or {}).get("n") or 0)


def unused_credits(conn, email: str) -> int:
    row = conn.execute(
        "SELECT COUNT(*) AS n FROM interview_retake_payments WHERE lower(email) = lower(%s) AND status = 'paid'",
        (email,),
    ).fetchone()
    return int((row or {}).get("n") or 0)


def retake_status(conn, email: str) -> dict[str, Any]:
    done = completed_career_interviews(conn, email)
    credits = unused_credits(conn, email)
    return {
        "completedInterviews": done,
        "freeInterviewAvailable": done == 0,
        "retakeCredits": credits,
        "canStartCareerInterview": done == 0 or credits > 0,
        "priceInr": retake_price_inr(),
        "paymentsConfigured": payments_configured(),
        "razorpayKeyId": razorpay_key_id() or None,
    }


def consume_credit_for_start(conn, email: str, session_id: str) -> bool:
    """Atomically use one paid credit for a new career interview. False if there is none."""
    row = conn.execute(
        """UPDATE interview_retake_payments SET status = 'used', used_at = NOW(), used_session_id = %s
           WHERE id = (
             SELECT id FROM interview_retake_payments
             WHERE lower(email) = lower(%s) AND status = 'paid'
             ORDER BY paid_at ASC NULLS LAST
             LIMIT 1
             FOR UPDATE SKIP LOCKED
           )
           RETURNING id""",
        (session_id, email),
    ).fetchone()
    return bool(row)


def check_career_interview_allowed(conn, email: str, session_id: str) -> None:
    """Raise 402 unless this career interview is the free first one or a paid credit is available (and used now)."""
    if completed_career_interviews(conn, email) == 0:
        return
    if consume_credit_for_start(conn, email, session_id):
        return
    raise RetakePaymentError(
        402,
        f"You have used your free interview. A retake costs ₹{retake_price_inr()}.",
        "RETAKE_PAYMENT_REQUIRED",
    )


# ---------------------------------------------------------------------------------------------------------------
# Razorpay API


async def create_order(conn, email: str) -> dict[str, Any]:
    if not payments_configured():
        raise RetakePaymentError(503, "Payments are not set up yet. Please try again later.", "PAYMENTS_NOT_CONFIGURED")
    import httpx

    amount_paise = retake_price_inr() * 100
    local_id = secrets.token_hex(12)
    try:
        async with httpx.AsyncClient(timeout=15.0) as http:
            res = await http.post(
                f"{RAZORPAY_API}/orders",
                auth=(razorpay_key_id(), _razorpay_secret()),
                json={
                    "amount": amount_paise,
                    "currency": "INR",
                    "receipt": f"retake_{local_id}",
                    "notes": {"purpose": "interview_retake", "email": email},
                },
            )
    except httpx.HTTPError as err:
        logger.warning("Razorpay order request failed: %s", err)
        raise RetakePaymentError(502, "Could not reach the payment provider. Please try again.") from err
    if res.status_code not in (200, 201):
        logger.warning("Razorpay order refused (%s): %s", res.status_code, res.text[:300])
        raise RetakePaymentError(502, "The payment provider refused the order. Please try again.")
    order = res.json()
    conn.execute(
        """INSERT INTO interview_retake_payments (id, email, provider_order_id, amount_paise, currency)
           VALUES (%s, %s, %s, %s, 'INR')""",
        (local_id, email.lower(), order["id"], amount_paise),
    )
    return {"orderId": order["id"], "amount": amount_paise, "currency": "INR", "keyId": razorpay_key_id(),
            "priceInr": retake_price_inr()}


def verify_payment(conn, email: str, order_id: str, payment_id: str, signature: str) -> dict[str, Any]:
    if not payments_configured():
        raise RetakePaymentError(503, "Payments are not set up yet.", "PAYMENTS_NOT_CONFIGURED")
    row = conn.execute(
        "SELECT id, email, status, provider_payment_id FROM interview_retake_payments WHERE provider_order_id = %s",
        (order_id,),
    ).fetchone()
    if not row or str(row["email"]).lower() != email.lower():
        raise RetakePaymentError(404, "Payment order not found for this account.")
    if not valid_signature(order_id, payment_id, signature):
        logger.warning("Retake payment signature mismatch for order %s", order_id)
        raise RetakePaymentError(400, "Payment could not be verified.", "PAYMENT_SIGNATURE_INVALID")
    if row["status"] in ("paid", "used"):
        # Idempotent: the browser may call verify twice. The same order never creates a second credit.
        return {"ok": True, "alreadyRecorded": True, **retake_status(conn, email)}
    conn.execute(
        """UPDATE interview_retake_payments SET status = 'paid', provider_payment_id = %s, paid_at = NOW()
           WHERE id = %s AND status = 'created'""",
        (payment_id, row["id"]),
    )
    return {"ok": True, **retake_status(conn, email)}
