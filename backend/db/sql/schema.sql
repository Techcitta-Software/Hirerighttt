-- HireRight SaaS PostgreSQL schema (Neon)
-- Multi-tenant: organizations, billing plans, jobs, applications, interviews.

-- ─── Subscription catalog (platform-wide) ───
CREATE TABLE IF NOT EXISTS subscription_plans (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  price_cents_monthly INT NOT NULL DEFAULT 0,
  price_cents_yearly INT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_public BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Tenant (employer / agency workspace) ───
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  logo_url TEXT,
  website TEXT,
  billing_email TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations (status);

-- ─── Billing per tenant ───
CREATE TABLE IF NOT EXISTS organization_subscriptions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES subscription_plans (id),
  status TEXT NOT NULL DEFAULT 'trialing',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id)
);

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_plan ON organization_subscriptions (plan_id);

-- ─── Auth sessions (Bearer tokens) ───
CREATE TABLE IF NOT EXISTS hireright_sessions (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hireright_sessions_email ON hireright_sessions (email);
CREATE INDEX IF NOT EXISTS idx_hireright_sessions_expires ON hireright_sessions (expires_at);

-- ─── Platform users (candidates + employer team members) ───
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'jobseeker',
  company_name TEXT,
  primary_organization_id TEXT REFERENCES organizations (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active',
  email_verified_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Upgrade columns before indexes reference them on existing installations.
ALTER TABLE users ADD COLUMN IF NOT EXISTS primary_organization_id TEXT REFERENCES organizations(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique ON users (phone) WHERE phone IS NOT NULL AND phone <> '';
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_primary_org ON users (primary_organization_id);

-- ─── Team membership (RBAC within tenant) ───
CREATE TABLE IF NOT EXISTS organization_members (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'recruiter',
  invited_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members (user_id);

-- ─── Pending invites ───
CREATE TABLE IF NOT EXISTS organization_invites (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'recruiter',
  token TEXT NOT NULL UNIQUE,
  invited_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_invites_email ON organization_invites (organization_id, email);

-- ─── Candidate profile wizard ───
CREATE TABLE IF NOT EXISTS profiles (
  email TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_profiles_user ON profiles (user_id);

-- ─── Employer job postings (tenant-scoped) ───
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  created_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  role_track TEXT,
  experience_level TEXT,
  location TEXT,
  job_description TEXT,
  required_skills JSONB NOT NULL DEFAULT '[]'::jsonb,
  shareable_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'published',
  published_at TIMESTAMPTZ,
  closes_at TIMESTAMPTZ,
  extras JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_org ON jobs (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_share_code ON jobs (shareable_code);

-- ─── Applications to employer jobs ───
CREATE TABLE IF NOT EXISTS employer_applications (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  candidate_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  candidate_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, candidate_email)
);

CREATE INDEX IF NOT EXISTS idx_employer_apps_org ON employer_applications (organization_id, applied_at DESC);

-- ─── Candidate job board applications (legacy JSON document per apply) ───
CREATE TABLE IF NOT EXISTS job_applications (
  id TEXT NOT NULL,
  email TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (email, id)
);

CREATE INDEX IF NOT EXISTS idx_job_applications_email ON job_applications (email, created_at DESC);

-- ─── Latest interview scorecard per candidate ───
CREATE TABLE IF NOT EXISTS interview_results (
  email TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  organization_id TEXT REFERENCES organizations (id) ON DELETE SET NULL,
  application_id TEXT,
  overall INT,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE interview_results ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_interview_results_org ON interview_results (organization_id);

-- ─── Scorecard history (usage / billing metrics) ───
CREATE TABLE IF NOT EXISTS interview_result_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  organization_id TEXT REFERENCES organizations (id) ON DELETE SET NULL,
  job_id TEXT REFERENCES jobs (id) ON DELETE SET NULL,
  overall INT,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interview_history_org ON interview_result_history (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interview_history_email ON interview_result_history (email, created_at DESC);

-- ─── AI interview runtime sessions ───
CREATE TABLE IF NOT EXISTS interview_sessions (
  session_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  organization_id TEXT REFERENCES organizations (id) ON DELETE SET NULL,
  job_id TEXT REFERENCES jobs (id) ON DELETE SET NULL,
  application_id TEXT,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_interview_sessions_org ON interview_sessions (organization_id);

-- ─── Employer confidential talent vault (tenant-scoped) ───
CREATE TABLE IF NOT EXISTS confidential_candidates (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE confidential_candidates ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_confidential_org ON confidential_candidates (organization_id, sort_order ASC);

-- ─── Audit trail (SaaS compliance) ───
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT REFERENCES organizations (id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_org_time ON audit_logs (organization_id, created_at DESC);

-- ─── Default subscription plans ───
INSERT INTO subscription_plans (id, code, name, description, price_cents_monthly, price_cents_yearly, limits, features, sort_order)
VALUES
  (
    'plan-free',
    'free',
    'Free',
    'For solo recruiters trying HireRight',
    0,
    0,
    '{"seats":2,"active_jobs":3,"interviews_per_month":25,"vault_candidates":50}'::jsonb,
    '{"ai_interviews":true,"basic_analytics":true}'::jsonb,
    0
  ),
  (
    'plan-starter',
    'starter',
    'Starter',
    'Growing teams screening candidates at scale',
    9900,
    99000,
    '{"seats":5,"active_jobs":15,"interviews_per_month":200,"vault_candidates":500}'::jsonb,
    '{"ai_interviews":true,"shareable_job_links":true,"email_support":true}'::jsonb,
    1
  ),
  (
    'plan-pro',
    'pro',
    'Professional',
    'Agencies and mid-market HR',
    29900,
    299000,
    '{"seats":25,"active_jobs":100,"interviews_per_month":2000,"vault_candidates":5000}'::jsonb,
    '{"ai_interviews":true,"priority_support":true,"custom_branding":true,"api_access":true}'::jsonb,
    2
  ),
  (
    'plan-enterprise',
    'enterprise',
    'Enterprise',
    'Custom limits, SSO, and dedicated success',
    0,
    0,
    '{"seats":999,"active_jobs":9999,"interviews_per_month":99999,"vault_candidates":99999}'::jsonb,
    '{"ai_interviews":true,"sso":true,"sla":true,"dedicated_csm":true}'::jsonb,
    3
  )
ON CONFLICT (id) DO NOTHING;

-- Platform org for global/demo assets
INSERT INTO organizations (id, name, slug, status, settings)
VALUES ('org-platform', 'HireRight Platform', 'hireright-platform', 'active', '{"is_platform":true}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO organization_subscriptions (id, organization_id, plan_id, status)
VALUES ('sub-platform', 'org-platform', 'plan-enterprise', 'active')
ON CONFLICT (organization_id) DO NOTHING;

-- ─── Upgrades from earlier HireRight schemas (safe to re-run) ───
ALTER TABLE users ADD COLUMN IF NOT EXISTS primary_organization_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE interview_results ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE interview_results ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE interview_results ADD COLUMN IF NOT EXISTS application_id TEXT;
ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS job_id TEXT;
ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS application_id TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'confidential_candidates' AND column_name = 'organization_id'
  ) THEN
    UPDATE confidential_candidates SET organization_id = 'org-platform' WHERE organization_id IS NULL;
  END IF;
END $$;
