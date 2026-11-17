-- Audit log lookups by action/time and retention sweeps by age.
CREATE INDEX IF NOT EXISTS idx_audit_action_time ON audit_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_interview_recordings_created ON interview_recordings (created_at);
CREATE INDEX IF NOT EXISTS idx_interview_artifacts_created ON interview_artifacts (created_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires ON password_reset_tokens (expires_at);
