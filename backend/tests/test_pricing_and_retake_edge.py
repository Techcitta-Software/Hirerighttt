"""Edge and invariant test suite for interview pricing, currency conversion,
retake credits, and payment verification idempotency.
"""

from __future__ import annotations

import hashlib
import hmac
import pytest
from unittest.mock import MagicMock

from app.services import retake_payments as rp


def _generate_signature(order_id: str, payment_id: str, secret: str) -> str:
    """Helper to generate a valid Razorpay HMAC-SHA256 signature."""
    return hmac.new(
        secret.encode(),
        f"{order_id}|{payment_id}".encode(),
        hashlib.sha256,
    ).hexdigest()


# ==============================================================================
# 1. ₹89 Pricing Logic & Environment Invariants
# ==============================================================================


def test_retake_price_default_is_89(monkeypatch):
    """When RETAKE_PRICE_INR is not set, default to ₹89."""
    monkeypatch.delenv("RETAKE_PRICE_INR", raising=False)
    assert rp.retake_price_inr() == 89


@pytest.mark.parametrize(
    "env_val, expected",
    [
        ("89", 89),
        ("149", 149),
        ("299", 299),
        ("0", 1),  # Clamped to at least 1
        ("-50", 1),  # Negative clamped to at least 1
        ("invalid", 89),  # Non-numeric string falls back to 89
        ("", 89),  # Empty string falls back to 89
        ("  ", 89),  # Whitespace falls back to 89
    ],
)
def test_retake_price_environment_resilience(monkeypatch, env_val, expected):
    monkeypatch.setenv("RETAKE_PRICE_INR", env_val)
    assert rp.retake_price_inr() == expected


def test_calculate_interview_tier_price():
    """Validates interview tier calculations and discount application."""
    # Standard pricing at ₹89
    assert rp.calculate_interview_tier_price(1, unit_price_inr=89) == 89
    assert rp.calculate_interview_tier_price(2, unit_price_inr=89) == 178
    assert rp.calculate_interview_tier_price(5, unit_price_inr=89) == 445
    assert rp.calculate_interview_tier_price(10, unit_price_inr=89) == 890

    # Custom unit prices
    assert rp.calculate_interview_tier_price(3, unit_price_inr=100) == 300

    # Discounts
    # 10% off ₹89 -> ₹89 - ₹9 = ₹80
    assert rp.calculate_interview_tier_price(1, unit_price_inr=89, discount_percent=10.0) == 80
    # 50% off ₹100 -> ₹50
    assert rp.calculate_interview_tier_price(1, unit_price_inr=100, discount_percent=50.0) == 50
    # 100% off -> ₹0
    assert rp.calculate_interview_tier_price(5, unit_price_inr=89, discount_percent=100.0) == 0


@pytest.mark.parametrize(
    "malformed_count",
    [0, -1, -100, "zero", None, [], {}, float("nan")],
)
def test_calculate_interview_tier_price_edge_cases(malformed_count):
    """Zero, negative, and malformed interview counts evaluate safely to 0."""
    assert rp.calculate_interview_tier_price(malformed_count, unit_price_inr=89) == 0


# ==============================================================================
# 2. Currency Conversions & Paise Calculations
# ==============================================================================


def test_inr_to_paise():
    """1 INR = 100 paise."""
    assert rp.inr_to_paise(89) == 8900
    assert rp.inr_to_paise(149) == 14900
    assert rp.inr_to_paise(89.50) == 8950
    assert rp.inr_to_paise(0) == 0
    assert rp.inr_to_paise(-89) == 0
    assert rp.inr_to_paise("invalid") == 0
    assert rp.inr_to_paise(None) == 0


def test_paise_to_inr():
    """100 paise = 1 INR."""
    assert rp.paise_to_inr(8900) == 89.0
    assert rp.paise_to_inr(14900) == 149.0
    assert rp.paise_to_inr(0) == 0.0
    assert rp.paise_to_inr(-500) == 0.0
    assert rp.paise_to_inr("not_a_number") == 0.0


def test_convert_currency():
    """Multi-currency conversions based on standard and custom rates."""
    # INR to USD at default rate 0.0115 (~1.02 USD)
    usd = rp.convert_currency(89, "USD")
    assert usd == 1.02

    # INR to EUR at default rate 0.0110 (~0.98 EUR)
    eur = rp.convert_currency(89, "EUR")
    assert eur == 0.98

    # INR to GBP at default rate 0.0093 (~0.83 GBP)
    gbp = rp.convert_currency(89, "GBP")
    assert gbp == 0.83

    # INR to INR is 1:1
    assert rp.convert_currency(89, "INR") == 89.0

    # Custom exchange rate
    assert rp.convert_currency(100, "USD", custom_rate=0.012) == 1.20

    # Unknown currency without custom rate falls back to base INR
    assert rp.convert_currency(89, "XYZ") == 89.0

    # Non-positive and malformed values return 0.0
    assert rp.convert_currency(0, "USD") == 0.0
    assert rp.convert_currency(-50, "USD") == 0.0
    assert rp.convert_currency("malformed", "USD") == 0.0


# ==============================================================================
# 3. Coupon Validation Guards
# ==============================================================================


def test_apply_coupon_guard_valid_codes():
    """WELCOME10 (10%), HIRERIGHT50 (50%), FREEPASS (100%)."""
    eff, disc, code = rp.apply_coupon_guard(89, "WELCOME10")
    assert code == "WELCOME10"
    assert disc == 9
    assert eff == 80

    eff, disc, code = rp.apply_coupon_guard(100, "hireright50 ")
    assert code == "HIRERIGHT50"
    assert disc == 50
    assert eff == 50

    eff, disc, code = rp.apply_coupon_guard(89, "FREEPASS")
    assert code == "FREEPASS"
    assert disc == 89
    assert eff == 0


def test_apply_coupon_guard_invalid_or_missing_codes():
    """Unknown or empty coupons leave the base price untouched."""
    eff, disc, code = rp.apply_coupon_guard(89, "INVALID_CODE")
    assert code is None
    assert disc == 0
    assert eff == 89

    eff, disc, code = rp.apply_coupon_guard(89, None)
    assert code is None
    assert disc == 0
    assert eff == 89

    eff, disc, code = rp.apply_coupon_guard(89, "")
    assert code is None
    assert disc == 0
    assert eff == 89


# ==============================================================================
# 4. Retake Payments, Credit Allocation & Invariants
# ==============================================================================


def test_job_interviews_are_never_charged():
    """Job interviews via applicationId, jobId, or inviteToken are always free."""
    assert rp.is_job_interview({"applicationId": "app-101"})
    assert rp.is_job_interview({"jobId": "job-202"})
    assert rp.is_job_interview({"inviteToken": "tok-303"})
    assert rp.is_job_interview(None, {"jobId": "job-from-session"})

    # Pure practice interviews are charged
    assert not rp.is_job_interview({"role": "Backend Engineer"})
    assert not rp.is_job_interview({})
    assert not rp.is_job_interview(None, None)


def test_first_career_interview_is_free(monkeypatch):
    """Candidates get their first practice interview free without requiring credits."""
    mock_conn = MagicMock()
    # 0 completed interviews
    mock_conn.execute.return_value.fetchone.return_value = {"n": 0}

    # Should not raise
    rp.check_career_interview_allowed(mock_conn, "new_candidate@example.com", "sess-1")


def test_second_career_interview_requires_payment_or_credit(monkeypatch):
    """Subsequent practice interviews raise RetakePaymentError 402 if no credit."""
    mock_conn = MagicMock()
    # 1 completed interview, 0 credits
    mock_conn.execute.return_value.fetchone.side_effect = [
        {"n": 1},  # completed_career_interviews
        None,  # consume_credit_for_start returns None (no paid credit)
    ]

    with pytest.raises(rp.RetakePaymentError) as exc_info:
        rp.check_career_interview_allowed(mock_conn, "returning_candidate@example.com", "sess-2")

    assert exc_info.value.status == 402
    assert exc_info.value.code == "RETAKE_PAYMENT_REQUIRED"
    assert "₹89" in str(exc_info.value)


def test_credit_consumption_allows_retake(monkeypatch):
    """When a paid credit exists, consume_credit_for_start consumes it and allows start."""
    mock_conn = MagicMock()
    # 1 completed interview, credit consumed successfully
    mock_conn.execute.return_value.fetchone.side_effect = [
        {"n": 1},  # completed_career_interviews
        {"id": "credit-id-123"},  # consume_credit_for_start RETURNING id
    ]

    # Should not raise
    rp.check_career_interview_allowed(mock_conn, "paying_candidate@example.com", "sess-2")


# ==============================================================================
# 5. Idempotency of Payment Verification & Webhooks
# ==============================================================================


def test_payment_verification_is_idempotent(monkeypatch):
    """Duplicate / replayed payment verification callbacks return alreadyRecorded: True

    and do not double-allocate credits.
    """
    secret = "rzp_secret_key_123"
    order_id = "order_alpha_1"
    payment_id = "pay_bravo_1"
    sig = _generate_signature(order_id, payment_id, secret)

    monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_test_key")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", secret)

    mock_conn = MagicMock()

    # Case 1: Payment already marked as 'paid'
    mock_conn.execute.return_value.fetchone.side_effect = [
        {"id": "row-1", "email": "candidate@example.com", "status": "paid", "provider_payment_id": payment_id},
        {"n": 1},  # completed_career_interviews
        {"n": 1},  # unused_credits
    ]

    result = rp.verify_payment(mock_conn, "candidate@example.com", order_id, payment_id, sig)
    assert result["ok"] is True
    assert result["alreadyRecorded"] is True
    assert result["retakeCredits"] == 1

    # Case 2: Payment already marked as 'used'
    mock_conn.execute.return_value.fetchone.side_effect = [
        {"id": "row-2", "email": "candidate@example.com", "status": "used", "provider_payment_id": payment_id},
        {"n": 2},  # completed_career_interviews
        {"n": 0},  # unused_credits
    ]

    result = rp.verify_payment(mock_conn, "candidate@example.com", order_id, payment_id, sig)
    assert result["ok"] is True
    assert result["alreadyRecorded"] is True


def test_payment_verification_rejects_tampered_signatures(monkeypatch):
    """Tampered order id, payment id, or signature raises 400 PAYMENT_SIGNATURE_INVALID."""
    secret = "rzp_secret_key_123"
    order_id = "order_alpha_1"
    payment_id = "pay_bravo_1"
    sig = _generate_signature(order_id, payment_id, secret)

    monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_test_key")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", secret)

    mock_conn = MagicMock()
    mock_conn.execute.return_value.fetchone.return_value = {
        "id": "row-1",
        "email": "candidate@example.com",
        "status": "created",
        "provider_payment_id": None,
    }

    # Swapped payment id with forged signature
    with pytest.raises(rp.RetakePaymentError) as exc_info:
        rp.verify_payment(mock_conn, "candidate@example.com", order_id, "pay_TAMPERED", sig)
    assert exc_info.value.status == 400
    assert exc_info.value.code == "PAYMENT_SIGNATURE_INVALID"


def test_payment_verification_enforces_tenant_email_isolation(monkeypatch):
    """Candidate B cannot verify an order belonging to Candidate A (returns 404)."""
    monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_test_key")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", "secret")

    mock_conn = MagicMock()
    # Order belongs to alice@example.com
    mock_conn.execute.return_value.fetchone.return_value = {
        "id": "row-1",
        "email": "alice@example.com",
        "status": "created",
    }

    # Bob tries to verify Alice's order
    with pytest.raises(rp.RetakePaymentError) as exc_info:
        rp.verify_payment(mock_conn, "bob@example.com", "order_alice_1", "pay_1", "sig")
    assert exc_info.value.status == 404
