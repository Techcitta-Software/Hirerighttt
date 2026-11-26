-- Invite status for recruiters and reminders when email is off. Idempotent: safe to re-run by hand.

-- First time the candidate opened the invite link ("Link opened" on the recruiter's invite status).
ALTER TABLE interview_invites ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;

-- Reminder that fell due while email was not configured: recorded so the recruiter / candidate see "reminder due"
-- in the app instead of the scheduler failing with 503. The *_sent_at columns stay for reminders actually emailed.
ALTER TABLE interview_invites ADD COLUMN IF NOT EXISTS reminder_due_kind TEXT;
ALTER TABLE interview_invites ADD COLUMN IF NOT EXISTS reminder_due_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_interview_invites_org_job ON interview_invites (organization_id, job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interview_sessions_invite_token ON interview_sessions ((data->>'inviteToken'));
