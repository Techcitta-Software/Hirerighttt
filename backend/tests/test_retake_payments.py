"""Paid interview retakes (Razorpay): signature check and which interviews are charged."""

import hashlib
import hmac

from app.services import retake_payments as rp


def _sign(order_id: str, payment_id: str, secret: str) -> str:
    return hmac.new(secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()


def test_valid_razorpay_signature_is_accepted():
    sig = _sign("order_ABC", "pay_XYZ", "s3cret")
    assert rp.valid_signature("order_ABC", "pay_XYZ", sig, secret="s3cret")


def test_forged_or_mismatched_signatures_are_rejected():
    sig = _sign("order_ABC", "pay_XYZ", "s3cret")
    assert not rp.valid_signature("order_ABC", "pay_OTHER", sig, secret="s3cret")  # payment swapped
    assert not rp.valid_signature("order_OTHER", "pay_XYZ", sig, secret="s3cret")  # order swapped
    assert not rp.valid_signature("order_ABC", "pay_XYZ", sig, secret="wrong")  # wrong secret
    assert not rp.valid_signature("order_ABC", "pay_XYZ", "", secret="s3cret")
    assert not rp.valid_signature("order_ABC", "pay_XYZ", sig, secret="")  # payments not configured


def test_job_interviews_are_never_charged():
    assert rp.is_job_interview({"applicationId": "app-1"})
    assert not rp.is_job_interview({"jobId": "job-1"})  # any open job id is public: not a proof (V-06)
    assert rp.is_job_interview({"inviteToken": "tok"})
    assert not rp.is_job_interview({"role": "Frontend Developer"})
    assert not rp.is_job_interview({})


def test_price_and_configuration_come_from_the_environment(monkeypatch):
    monkeypatch.delenv("RETAKE_PRICE_INR", raising=False)
    assert rp.retake_price_inr() == 89
    monkeypatch.setenv("RETAKE_PRICE_INR", "149")
    assert rp.retake_price_inr() == 149
    monkeypatch.setenv("RETAKE_PRICE_INR", "abc")
    assert rp.retake_price_inr() == 89
    monkeypatch.delenv("RAZORPAY_KEY_ID", raising=False)
    monkeypatch.delenv("RAZORPAY_KEY_SECRET", raising=False)
    assert not rp.payments_configured()
    monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_test_123")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", "secret")
    assert rp.payments_configured()
