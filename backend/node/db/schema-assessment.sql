-- Additive structured assessments. Kept separate from legacy snapshot-managed tables.
CREATE TABLE IF NOT EXISTS assessment_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, description TEXT NOT NULL, experience_level TEXT NOT NULL,
  competencies JSONB NOT NULL CHECK (jsonb_array_length(competencies) = 7),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, organization_id)
);
CREATE TABLE IF NOT EXISTS assessment_resumes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id TEXT NOT NULL REFERENCES users(id),
  filename TEXT NOT NULL, extracted_text TEXT NOT NULL,
  extraction_status TEXT NOT NULL DEFAULT 'needs_candidate_review',
  analysis JSONB, analysis_model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (id, candidate_id)
);
ALTER TABLE assessment_resumes ADD COLUMN IF NOT EXISTS analysis JSONB;
ALTER TABLE assessment_resumes ADD COLUMN IF NOT EXISTS analysis_model TEXT;
CREATE TABLE IF NOT EXISTS interview_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  candidate_id TEXT NOT NULL REFERENCES users(id),
  job_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','ready')),
  version INT NOT NULL DEFAULT 1 CHECK (version > 0),
  model TEXT NOT NULL, prompt_version TEXT NOT NULL,
  approved_by TEXT REFERENCES users(id), approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (job_id, organization_id) REFERENCES assessment_jobs(id, organization_id),
  UNIQUE (id, organization_id), UNIQUE (id, candidate_id, organization_id)
);
CREATE TABLE IF NOT EXISTS interview_questions (
  plan_id UUID NOT NULL REFERENCES interview_plans(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL, position INT NOT NULL CHECK (position BETWEEN 0 AND 6),
  data JSONB NOT NULL,
  PRIMARY KEY (plan_id, question_id), UNIQUE (plan_id, position)
);
CREATE TABLE IF NOT EXISTS assessment_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL UNIQUE,
  organization_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','in_progress','paused','completed','cancelled','failed')),
  current_index INT NOT NULL DEFAULT 0 CHECK (current_index BETWEEN 0 AND 7),
  version INT NOT NULL DEFAULT 1 CHECK (version > 0),
  consent_at TIMESTAMPTZ, started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (plan_id, candidate_id, organization_id) REFERENCES interview_plans(id, candidate_id, organization_id),
  UNIQUE(id, plan_id), UNIQUE(id, organization_id)
);
CREATE TABLE IF NOT EXISTS interview_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL, plan_id UUID NOT NULL, question_id TEXT NOT NULL,
  request_id TEXT NOT NULL, answer_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('submitted','skipped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (session_id, plan_id) REFERENCES assessment_sessions(id, plan_id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id, question_id) REFERENCES interview_questions(plan_id, question_id),
  UNIQUE(session_id, question_id), UNIQUE(session_id, request_id)
);
CREATE TABLE IF NOT EXISTS answer_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  answer_id UUID NOT NULL UNIQUE REFERENCES interview_answers(id) ON DELETE CASCADE,
  data JSONB NOT NULL, score INT NOT NULL CHECK (score BETWEEN 0 AND 4),
  model TEXT NOT NULL, prompt_version TEXT NOT NULL, rubric_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS recruiter_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id UUID NOT NULL REFERENCES answer_evaluations(id) ON DELETE CASCADE,
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  score INT NOT NULL CHECK (score BETWEEN 0 AND 4),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS interview_reports (
  session_id UUID PRIMARY KEY REFERENCES assessment_sessions(id) ON DELETE CASCADE,
  data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS assessment_events (
  id BIGSERIAL PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
  actor_id TEXT NOT NULL REFERENCES users(id), session_id UUID REFERENCES assessment_sessions(id) ON DELETE SET NULL,
  action TEXT NOT NULL, meta JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS assessment_usage (
  id BIGSERIAL PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
  purpose TEXT NOT NULL, model TEXT, tokens INT NOT NULL DEFAULT 0 CHECK (tokens >= 0),
  latency_ms INT NOT NULL CHECK (latency_ms >= 0), source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assessment_jobs_org ON assessment_jobs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assessment_resumes_owner ON assessment_resumes(candidate_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_assessment_plans_org ON interview_plans(organization_id, candidate_id);
CREATE INDEX IF NOT EXISTS idx_assessment_sessions_candidate ON assessment_sessions(candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assessment_sessions_org ON assessment_sessions(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assessment_reviews_evaluation ON recruiter_reviews(evaluation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_assessment_events_org ON assessment_events(organization_id, created_at DESC);
