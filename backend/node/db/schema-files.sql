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
