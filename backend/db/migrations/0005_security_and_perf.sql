-- Security audit follow-ups (V-06, V-13) and missing indexes (P-04). Idempotent: safe to re-run by hand.

-- V-06: the free career interview is claimed atomically. One row per candidate with status 'free_used'
-- (provider_order_id = 'free:<email>', amount 0). Two parallel /api/interview/start calls race on this index:
-- exactly one INSERT wins, the other must use a paid retake credit.
CREATE UNIQUE INDEX IF NOT EXISTS uq_retake_free_claim_email
  ON interview_retake_payments (lower(email)) WHERE status = 'free_used';

-- V-13: failed sign-in counters shared by every API worker / instance (no Redis on the free tier).
-- email_hash = sha256(lower(email)), so the table holds no addresses.
CREATE TABLE IF NOT EXISTS login_failures (
  email_hash TEXT PRIMARY KEY,
  failures INT NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_login_failures_updated ON login_failures (updated_at);

-- P-04: case-insensitive email lookups (retake checks on every interview start / status call, resume replace purge)
-- used to seq-scan these tables.
CREATE INDEX IF NOT EXISTS idx_interview_sessions_email_lower ON interview_sessions (lower(email));
CREATE INDEX IF NOT EXISTS idx_interview_recordings_email_lower ON interview_recordings (lower(candidate_email));
CREATE INDEX IF NOT EXISTS idx_interview_artifacts_email_lower ON interview_artifacts (lower(candidate_email));
