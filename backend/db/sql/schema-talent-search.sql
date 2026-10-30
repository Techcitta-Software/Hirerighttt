-- Employer talent search (marketplace + org-scoped access)
-- Run after schema.sql on every deploy.

CREATE TABLE IF NOT EXISTS candidate_talent_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role_title TEXT,
  location TEXT,
  experience_years TEXT,
  skills TEXT[] NOT NULL DEFAULT '{}',
  summary TEXT,
  resume_snippet TEXT,
  interview_score INT,
  profile_visibility TEXT NOT NULL DEFAULT 'marketplace',
  search_vector TSVECTOR,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT candidate_talent_visibility_check
    CHECK (profile_visibility IN ('marketplace', 'organization_only', 'private'))
);

CREATE INDEX IF NOT EXISTS idx_talent_search_vector
  ON candidate_talent_profiles USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_talent_skills_gin
  ON candidate_talent_profiles USING GIN (skills);
CREATE INDEX IF NOT EXISTS idx_talent_location
  ON candidate_talent_profiles (location);
CREATE INDEX IF NOT EXISTS idx_talent_interview_score
  ON candidate_talent_profiles (interview_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_talent_visibility
  ON candidate_talent_profiles (profile_visibility);

-- Which candidates an employer org may view (applications, interviews, manual grant)
CREATE TABLE IF NOT EXISTS organization_talent_access (
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  access_type TEXT NOT NULL DEFAULT 'application',
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_talent_access_user
  ON organization_talent_access (user_id);

-- Saved searches (recruiter UX)
CREATE TABLE IF NOT EXISTS recruiter_saved_searches (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  created_by_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  query JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION candidate_talent_profiles_search_vector_refresh()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.full_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.role_title, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.location, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW.skills, ' '), '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.resume_snippet, '')), 'D');
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_candidate_talent_search_vector ON candidate_talent_profiles;
CREATE TRIGGER trg_candidate_talent_search_vector
  BEFORE INSERT OR UPDATE ON candidate_talent_profiles
  FOR EACH ROW
  EXECUTE PROCEDURE candidate_talent_profiles_search_vector_refresh();
