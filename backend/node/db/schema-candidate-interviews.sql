-- Candidates (Feature 2) and per-answer interview results (Feature 1).
CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  phone TEXT,
  password_hash TEXT NOT NULL,
  job_title TEXT NOT NULL DEFAULT '',
  total_experience TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  resume_skills TEXT[] NOT NULL DEFAULT '{}',
  resume_name TEXT,
  resume_text TEXT NOT NULL DEFAULT '',
  experience_summary TEXT NOT NULL DEFAULT '',
  work_experiences JSONB NOT NULL DEFAULT '[]'::jsonb,
  certifications JSONB NOT NULL DEFAULT '[]'::jsonb,
  preferred_roles TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_candidates_resume_skills ON candidates USING GIN (resume_skills);

CREATE TABLE IF NOT EXISTS candidate_interview_results (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidate_name TEXT NOT NULL DEFAULT '',
  candidate_email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT '',
  qa_pairs JSONB NOT NULL DEFAULT '[]'::jsonb,
  final_score INTEGER CHECK (final_score IS NULL OR (final_score BETWEEN 0 AND 100)),
  scored_count INTEGER NOT NULL DEFAULT 0,
  answer_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cir_candidate ON candidate_interview_results (candidate_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cir_status ON candidate_interview_results (status);
