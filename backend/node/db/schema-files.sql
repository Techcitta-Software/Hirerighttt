-- Private file metadata (bytes live in S3 or legacy Supabase). Neon remains source of truth for ownership.

CREATE TABLE IF NOT EXISTS stored_files (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  owner_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  purpose TEXT NOT NULL DEFAULT 'resume',
  storage_provider TEXT NOT NULL CHECK (storage_provider IN ('s3', 'supabase')),
  bucket TEXT,
  object_key TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stored_files_owner ON stored_files (owner_email, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stored_files_object ON stored_files (storage_provider, bucket, object_key);

ALTER TABLE stored_files ADD COLUMN IF NOT EXISTS tenant_id TEXT;
ALTER TABLE stored_files ADD COLUMN IF NOT EXISTS entity_id TEXT;
ALTER TABLE stored_files ADD COLUMN IF NOT EXISTS file_category TEXT;
ALTER TABLE stored_files ADD COLUMN IF NOT EXISTS version_number INT;

CREATE INDEX IF NOT EXISTS idx_stored_files_tenant_entity
  ON stored_files (tenant_id, entity_id, file_category, created_at DESC);

-- Interview recording metadata (video bytes in S3 under tenants/.../interviews/.../recordings/)
CREATE TABLE IF NOT EXISTS interview_recordings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  interview_id TEXT NOT NULL,
  candidate_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  candidate_email TEXT NOT NULL,
  s3_object_key TEXT NOT NULL,
  bucket TEXT,
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size_bytes BIGINT,
  duration_seconds NUMERIC,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interview_recordings_interview
  ON interview_recordings (interview_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interview_recordings_candidate
  ON interview_recordings (candidate_email, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_recordings_object
  ON interview_recordings (s3_object_key);

-- Transcripts and generated PDF reports (s3.md §4 D–F)
CREATE TABLE IF NOT EXISTS interview_artifacts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  interview_id TEXT NOT NULL,
  candidate_email TEXT NOT NULL,
  artifact_type TEXT NOT NULL CHECK (artifact_type IN ('transcript', 'report', 'audio')),
  s3_object_key TEXT NOT NULL,
  bucket TEXT,
  content_type TEXT NOT NULL,
  byte_size BIGINT,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_artifacts_session_type
  ON interview_artifacts (interview_id, artifact_type);
CREATE INDEX IF NOT EXISTS idx_interview_artifacts_candidate
  ON interview_artifacts (candidate_email, created_at DESC);
