-- Paid interview retakes (Razorpay). The first career interview is free; each further career interview needs one
-- paid credit, consumed when that interview starts. Interviews for a vendor's job are never charged.
CREATE TABLE IF NOT EXISTS interview_retake_payments (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'razorpay',
  provider_order_id TEXT NOT NULL UNIQUE,
  provider_payment_id TEXT UNIQUE,
  amount_paise INT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'created',          -- created -> paid -> used
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  used_session_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_retake_payments_email_status ON interview_retake_payments (lower(email), status, paid_at);
