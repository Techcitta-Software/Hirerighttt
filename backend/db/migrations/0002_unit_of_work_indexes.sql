-- Per-request data access (app/db/uow.py + app/db/finders.py): every lookup the routes make is now an indexed query.

-- Small keyed documents that used to live only in process memory (lost on every restart):
--   candidate_alerts (key = candidate email), employer_alerts (key = organization id), contact (key = request id)
CREATE TABLE IF NOT EXISTS app_kv (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (namespace, key)
);
CREATE INDEX IF NOT EXISTS idx_app_kv_updated ON app_kv (namespace, updated_at DESC);

-- A candidate's interview sessions, applications to employers, and the public job board.
CREATE INDEX IF NOT EXISTS idx_interview_sessions_email ON interview_sessions (email, updated_at);
CREATE INDEX IF NOT EXISTS idx_employer_apps_candidate ON employer_applications (candidate_email, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_employer_apps_job ON employer_applications (job_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_open ON jobs (created_at DESC) WHERE COALESCE(status, 'published') IN ('active', 'published');
CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members (organization_id, joined_at);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users (phone) WHERE phone IS NOT NULL AND phone <> '';
CREATE INDEX IF NOT EXISTS idx_jobs_share_code_lower ON jobs (LOWER(shareable_code));

-- interview_sessions.organization_id existed but was never written: back-fill it from the session data.
UPDATE interview_sessions s SET organization_id = s.data->>'organizationId'
WHERE s.organization_id IS NULL AND s.data ? 'organizationId'
  AND EXISTS (SELECT 1 FROM organizations o WHERE o.id = s.data->>'organizationId');

-- Invite links are single-use; applications are marked when their job is deleted.
CREATE INDEX IF NOT EXISTS idx_interview_sessions_invite ON interview_sessions ((data->>'inviteToken')) WHERE data ? 'inviteToken';
CREATE INDEX IF NOT EXISTS idx_job_applications_job ON job_applications ((data->>'jobId'));
