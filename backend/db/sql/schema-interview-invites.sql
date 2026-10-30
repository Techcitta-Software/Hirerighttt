-- Scheduled AI interview invites (email link + time window)
CREATE TABLE IF NOT EXISTS interview_invites (
  token TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations (id) ON DELETE SET NULL,
  application_id TEXT,
  job_id TEXT,
  candidate_email TEXT NOT NULL,
  candidate_name TEXT,
  job_title TEXT,
  scheduled_start TIMESTAMPTZ NOT NULL,
  scheduled_end TIMESTAMPTZ NOT NULL,
  created_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  email_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interview_invites_org ON interview_invites (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interview_invites_candidate ON interview_invites (candidate_email, scheduled_start DESC);

-- Resume + JD snapshot for personalized interviews at invite time
ALTER TABLE interview_invites ADD COLUMN IF NOT EXISTS context_json JSONB NOT NULL DEFAULT '{}'::jsonb;
