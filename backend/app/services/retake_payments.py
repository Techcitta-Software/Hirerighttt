"""Paid interview retakes with Razorpay.

Rules
- The first career (practice) interview is free. The free slot is CLAIMED atomically when that interview starts
  (a 'free_used' row, unique per email: migration 0005), so parallel starts cannot all be free (V-06).
- Every further career interview needs one paid retake credit (₹89 by default), consumed when that interview starts.
- Interviews for a vendor's job are never charged, but only when the server resolved the job link itself: an
  application by this candidate, or a valid invite for them. A bare jobId from the browser is NOT enough (V-06).

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


def inr_to_paise(amount_inr: int | float) -> int:
    """Convert INR to Razorpay paise (1 INR = 100 paise). Handles rounding and non-positive values."""
    try:
        val = float(amount_inr)
        if val <= 0 or val != val:  # nan check
            return 0
        return int(round(val * 100))
    except (TypeError, ValueError):
        return 0


def paise_to_inr(paise: int) -> float:
    """Convert Razorpay paise back to INR."""
    try:
        val = int(paise)
        return max(0.0, val / 100.0)
    except (TypeError, ValueError):
        return 0.0


def calculate_interview_tier_price(
    count: int | Any,
    unit_price_inr: int | None = None,
    discount_percent: float = 0.0,
) -> int:
    """Calculate total price for `count` interviews.
    Clamps negative or non-integer counts to 0. Enforces ₹89 fallback."""
    try:
        c = int(count)
        if c <= 0:
            return 0
    except (TypeError, ValueError):
        return 0

    unit = unit_price_inr if (unit_price_inr is not None and unit_price_inr > 0) else retake_price_inr()
    subtotal = c * unit
    try:
        disc = max(0.0, min(100.0, float(discount_percent)))
    except (TypeError, ValueError):
        disc = 0.0

    discount_amount = int(round((subtotal * disc) / 100.0))
    return max(0, subtotal - discount_amount)


# Approximate exchange rates relative to INR (1 USD = ~87 INR, 1 EUR = ~91 INR, etc.)
DEFAULT_FX_RATES: dict[str, float] = {
    "INR": 1.0,
    "USD": 0.0115,  # ~ ₹89 INR -> ~$1.02 USD
    "EUR": 0.0110,
    "GBP": 0.0093,
    "AED": 0.0422,
    "SGD": 0.0155,
}


def convert_currency(
    amount_inr: float | int,
    target_currency: str = "INR",
    custom_rate: float | None = None,
) -> float:
    """Convert an INR amount to a target currency.
    If target is unknown and no custom rate provided, returns amount_inr in INR.
    Results rounded to 2 decimal places."""
    try:
        base = max(0.0, float(amount_inr))
    except (TypeError, ValueError):
        return 0.0

    target = (target_currency or "INR").strip().upper()
    if target == "INR":
        return round(base, 2)

    rate = custom_rate
    if rate is None or rate <= 0:
        rate = DEFAULT_FX_RATES.get(target)

    if not rate:
        return round(base, 2)

    return round(base * rate, 2)


# (V-25) The unused hard-coded coupon table, including a 100 % "FREEPASS" code, was removed. Discounts, if ever
# needed, must live in the database under admin control, never in source.


def razorpay_key_id() -> str:
    return (os.environ.get("RAZORPAY_KEY_ID") or "").strip()


def _razorpay_secret() -> str:
    return (os.environ.get("RAZORPAY_KEY_SECRET") or "").strip()


def payments_configured() -> bool:
    return bool(razorpay_key_id() and _razorpay_secret())


def is_job_interview(body: dict[str, Any] | None, session: dict[str, Any] | None = None) -> bool:
    """Does this request / session CLAIM to be a vendor's job interview (application or invite)?

    A bare jobId no longer counts: any open job id is public, so it made every interview free. Routes must still
    verify the claim on the server (the application belongs to the candidate, the invite is valid for them) and use
    `verified_job_interview` with the resolved objects."""
    for src in (body or {}, session or {}):
        if src.get("applicationId") or src.get("inviteToken"):
            return True
    return False


def verified_job_interview(*, application: dict | None, invite_token: str | None) -> bool:
    """Free job interview: the server resolved an application owned by the candidate, or a valid invite for them."""
    return bool(application) or bool(invite_token)


def valid_signature(order_id: str, payment_id: str, signature: str, secret: str | None = None) -> bool:
    secret = secret if secret is not None else _razorpay_secret()
    if not (order_id and payment_id and signature and secret):
        return False
    expected = hmac.new(secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature.strip())


# ---------------------------------------------------------------------------------------------------------------
# Database (Postgres). `conn` is a psycopg connection with dict_row.


def completed_career_interviews(conn, email: str) -> int:
    # Sessions written since V-06 carry careerInterview=true/false (decided on the server). Older sessions fall back
    # to the link fields. lower(email) is indexed (migration 0005).
    row = conn.execute(
        """SELECT COUNT(*) AS n FROM interview_sessions
           WHERE lower(email) = lower(%s)
             AND data->>'status' = 'completed'
             AND (
               data->>'careerInterview' = 'true'
               OR (
                 NOT (data ? 'careerInterview')
                 AND COALESCE(data->>'applicationId', '') = ''
                 AND COALESCE(data->>'jobId', '') = ''
                 AND COALESCE(data->>'inviteToken', '') = ''
               )
             )""",
        (email,),
    ).fetchone()
    return int((row or {}).get("n") or 0)


def free_interview_claimed(conn, email: str) -> bool:
    row = conn.execute(
        "SELECT 1 AS used FROM interview_retake_payments WHERE lower(email) = lower(%s) AND status = 'free_used' LIMIT 1",
        (email,),
    ).fetchone()
    return bool(row)


def claim_free_interview(conn, email: str, session_id: str) -> bool:
    """Atomically take the one free career interview. False when it is already taken (by this or a parallel start).

    The partial unique index uq_retake_free_claim_email (migration 0005) and the UNIQUE provider_order_id make the
    INSERT the single point of truth: of N concurrent starts exactly one gets a row back."""
    row = conn.execute(
        """INSERT INTO interview_retake_payments
             (id, email, provider, provider_order_id, amount_paise, currency, status, used_at, used_session_id)
           VALUES (%s, %s, 'free', %s, 0, 'INR', 'free_used', NOW(), %s)
           ON CONFLICT DO NOTHING
           RETURNING id""",
        (secrets.token_hex(12), email.lower(), f"free:{email.lower()}", session_id),
    ).fetchone()
    return bool(row)


def unused_credits(conn, email: str) -> int:
    row = conn.execute(
        "SELECT COUNT(*) AS n FROM interview_retake_payments WHERE lower(email) = lower(%s) AND status = 'paid'",
        (email,),
    ).fetchone()
    return int((row or {}).get("n") or 0)


def retake_status(conn, email: str) -> dict[str, Any]:
    done = completed_career_interviews(conn, email)
    credits = unused_credits(conn, email)
    free_left = done == 0 and not free_interview_claimed(conn, email)
    return {
        "completedInterviews": done,
        "freeInterviewAvailable": free_left,
        "retakeCredits": credits,
        "canStartCareerInterview": free_left or credits > 0,
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
    """Raise 402 unless this career interview is the free first one (claimed now, atomically) or a paid credit is
    available (and used now)."""
    if completed_career_interviews(conn, email) == 0 and claim_free_interview(conn, email, session_id):
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
    """`conn` is a connection, or a zero-argument callable returning a context manager that yields one. With the
    callable form no pooled connection is held while waiting up to 15 s for Razorpay (P-02)."""
    if not payments_configured():
        raise RetakePaymentError(503, "Payments are not set up yet. Please try again later.", "PAYMENTS_NOT_CONFIGURED")
    import httpx

    amount_paise = retake_price_inr() * 100
    local_id = secrets.token_hex(12)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0)) as http:
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

    def _insert(c) -> None:
        c.execute(
            """INSERT INTO interview_retake_payments (id, email, provider_order_id, amount_paise, currency)
               VALUES (%s, %s, %s, %s, 'INR')""",
            (local_id, email.lower(), order["id"], amount_paise),
        )

    if callable(conn):
        import asyncio

        def _write() -> None:
            with conn() as c:
                _insert(c)
                c.commit()

        await asyncio.to_thread(_write)
    else:
        _insert(conn)
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
