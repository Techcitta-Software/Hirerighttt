-- HireRightt normalized expansion, PostgreSQL 17 / Neon and Amazon RDS PostgreSQL.
-- DESIGN / BRANCH VALIDATION ONLY: not loaded by applySchema.mjs.
-- Run AFTER the current public schema. Existing writers remain authoritative until cutover.
-- Apply once with a migration transaction; rerun through rollback-only validate-v2.mjs.
-- public identity, tenancy, billing, jobs and talent tables are deliberately reused.

CREATE SCHEMA hiring;
REVOKE ALL ON SCHEMA hiring FROM PUBLIC;

-- Composite keys make tenant/candidate mismatches impossible in new relationships.
CREATE UNIQUE INDEX v2_jobs_tenant_key ON public.jobs(id, organization_id);
CREATE UNIQUE INDEX v2_application_tenant_key
  ON public.employer_applications(id, job_id, organization_id, candidate_user_id);

CREATE TABLE hiring.candidate_profiles (
  user_id TEXT PRIMARY KEY REFERENCES public.users(id),
  current_role TEXT,
  experience_label TEXT, -- Preserve current ranges; do not invent an exact number.
  experience_months INT CHECK (experience_months >= 0),
  location TEXT, notice_period TEXT, summary TEXT,
  introduction TEXT, motivation TEXT, strengths TEXT,
  self_rating NUMERIC, work_mode TEXT, salary_expectation TEXT,
  interview_notes TEXT,
  completed_steps INT NOT NULL DEFAULT 0 CHECK (completed_steps BETWEEN 0 AND 5),
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private','organization_only','marketplace')),
  version INT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE hiring.candidate_skills (
  candidate_id TEXT NOT NULL REFERENCES hiring.candidate_profiles(user_id),
  skill_name TEXT NOT NULL CHECK (length(trim(skill_name)) > 0),
  position INT NOT NULL CHECK (position >= 0),
  PRIMARY KEY(candidate_id, skill_name), UNIQUE(candidate_id, position)
);
CREATE TABLE hiring.work_experiences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id TEXT NOT NULL REFERENCES hiring.candidate_profiles(user_id),
  source_item_id TEXT,
  title TEXT NOT NULL, company TEXT NOT NULL, employment_type TEXT, location TEXT,
  start_date DATE, end_date DATE, is_current BOOLEAN NOT NULL DEFAULT false,
  responsibilities TEXT, position INT NOT NULL DEFAULT 0 CHECK (position >= 0),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  CHECK (NOT is_current OR end_date IS NULL),
  UNIQUE(candidate_id, source_item_id)
);
CREATE TABLE hiring.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id TEXT NOT NULL REFERENCES hiring.candidate_profiles(user_id),
  title TEXT NOT NULL, description TEXT, contribution TEXT, outcome TEXT,
  technologies TEXT[] NOT NULL DEFAULT '{}',
  source TEXT NOT NULL CHECK (source IN ('candidate','resume')),
  position INT NOT NULL DEFAULT 0 CHECK (position >= 0)
);
CREATE TABLE hiring.certifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id TEXT NOT NULL REFERENCES hiring.candidate_profiles(user_id),
  source_item_id TEXT, name TEXT NOT NULL, issuer TEXT,
  earned_on DATE, credential_id TEXT,
  position INT NOT NULL DEFAULT 0 CHECK (position >= 0),
  UNIQUE(candidate_id, source_item_id)
);
CREATE TABLE hiring.profile_highlights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id TEXT NOT NULL REFERENCES hiring.candidate_profiles(user_id),
  kind TEXT NOT NULL CHECK (kind IN ('achievement','award','performance_metric')),
  description TEXT NOT NULL, contribution TEXT, impact TEXT, time_period TEXT,
  position INT NOT NULL DEFAULT 0 CHECK (position >= 0)
);
CREATE TABLE hiring.candidate_preferences (
  candidate_id TEXT NOT NULL REFERENCES hiring.candidate_profiles(user_id),
  kind TEXT NOT NULL CHECK (kind IN ('role','location')),
  value TEXT NOT NULL,
  position INT NOT NULL DEFAULT 0 CHECK (position >= 0),
  PRIMARY KEY(candidate_id, kind, value)
);

-- A candidate may have many interviews, including personal practice interviews.
-- Tenant NULL means personal scope. Never map personal candidates to an employer.
CREATE TABLE hiring.interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT REFERENCES public.organizations(id),
  candidate_id TEXT NOT NULL REFERENCES public.users(id),
  job_id TEXT,
  application_id TEXT,
  workflow TEXT NOT NULL CHECK (workflow IN ('main','assessment')),
  source_session_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ready','in_progress','paused','completed','cancelled','failed')),
  role_title TEXT, experience_label TEXT,
  question_plan JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(question_plan) = 'object'),
  model TEXT, prompt_version TEXT, rubric_version TEXT,
  current_question INT NOT NULL DEFAULT 0 CHECK (current_question >= 0),
  version INT NOT NULL DEFAULT 1 CHECK (version > 0),
  started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workflow, source_session_id),
  UNIQUE(id, candidate_id),
  UNIQUE(id, organization_id, candidate_id),
  FOREIGN KEY(job_id, organization_id) REFERENCES public.jobs(id, organization_id),
  FOREIGN KEY(application_id, job_id, organization_id, candidate_id)
    REFERENCES public.employer_applications(id, job_id, organization_id, candidate_user_id),
  CHECK (job_id IS NULL OR organization_id IS NOT NULL),
  CHECK (application_id IS NULL OR (job_id IS NOT NULL AND organization_id IS NOT NULL)),
  CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
);
CREATE INDEX interviews_tenant_time ON hiring.interviews(organization_id, created_at DESC);
CREATE INDEX interviews_candidate_time ON hiring.interviews(candidate_id, created_at DESC);
CREATE INDEX interviews_application ON hiring.interviews(application_id);

-- One metadata registry for bytes in S3. No blobs, base64 or presigned URLs.
-- Legacy Supabase references can be inventoried without pretending they are S3 files.
CREATE TABLE hiring.file_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT REFERENCES public.organizations(id),
  candidate_id TEXT NOT NULL REFERENCES public.users(id),
  interview_id UUID,
  category TEXT NOT NULL CHECK (category IN ('resume','report','recording','transcript','audio','parsed_resume')),
  provider TEXT NOT NULL CHECK (provider IN ('s3','supabase')),
  bucket TEXT NOT NULL CHECK (length(trim(bucket)) > 0),
  object_key TEXT NOT NULL CHECK (length(object_key) > 0),
  storage_version_id TEXT NOT NULL DEFAULT '',
  version INT NOT NULL DEFAULT 1 CHECK (version > 0),
  original_filename TEXT, content_type TEXT NOT NULL,
  byte_size BIGINT CHECK (byte_size >= 0), sha256 TEXT,
  duration_ms BIGINT CHECK (duration_ms >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','ready','failed','deleting','deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ,
  UNIQUE(provider, bucket, object_key, storage_version_id),
  UNIQUE(id, candidate_id),
  UNIQUE(id, interview_id, category),
  FOREIGN KEY(interview_id, candidate_id) REFERENCES hiring.interviews(id, candidate_id),
  CHECK ((category IN ('resume','parsed_resume') AND interview_id IS NULL)
     OR (category IN ('report','recording','transcript','audio') AND interview_id IS NOT NULL)),
  CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$')
);
-- NULL-safe tenant equality is needed for personal interviews too.
CREATE FUNCTION hiring.check_file_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.candidate_id, NEW.organization_id, NEW.interview_id, NEW.category,
           NEW.provider, NEW.bucket, NEW.object_key, NEW.storage_version_id)
       IS DISTINCT FROM
       ROW(OLD.candidate_id, OLD.organization_id, OLD.interview_id, OLD.category,
           OLD.provider, OLD.bucket, OLD.object_key, OLD.storage_version_id) THEN
      RAISE EXCEPTION 'File ownership and object identity are immutable; create a new file version'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.interview_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM hiring.interviews i WHERE i.id = NEW.interview_id
      AND i.candidate_id = NEW.candidate_id
      AND i.organization_id IS NOT DISTINCT FROM NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'File scope must match interview scope' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER file_scope BEFORE INSERT OR UPDATE ON hiring.file_objects
  FOR EACH ROW EXECUTE FUNCTION hiring.check_file_scope();
-- Parent scope is immutable: changing a candidate/tenant would invalidate assets and consent.
CREATE FUNCTION hiring.prevent_interview_rescope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'Interview ownership is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER interview_scope BEFORE UPDATE ON hiring.interviews
  FOR EACH ROW EXECUTE FUNCTION hiring.prevent_interview_rescope();
CREATE INDEX file_objects_candidate ON hiring.file_objects(candidate_id, category, created_at DESC);
CREATE INDEX file_objects_interview ON hiring.file_objects(interview_id, category, version DESC);
CREATE INDEX file_objects_tenant ON hiring.file_objects(organization_id, created_at DESC);

CREATE TABLE hiring.resume_parses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES hiring.file_objects(id),
  parser TEXT NOT NULL, parser_version TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued','processing','needs_candidate_review','ready','failed')),
  extracted_text TEXT, analysis JSONB,
  error_code TEXT, expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT(file_id, parser, parser_version)
);
CREATE FUNCTION hiring.check_resume_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hiring.file_objects WHERE id = NEW.file_id AND category = 'resume') THEN
    RAISE EXCEPTION 'Resume parsing requires an original resume file' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER resume_source BEFORE INSERT OR UPDATE ON hiring.resume_parses
  FOR EACH ROW EXECUTE FUNCTION hiring.check_resume_source();
CREATE TABLE hiring.interview_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id UUID NOT NULL REFERENCES hiring.interviews(id),
  source_question_id TEXT,
  position INT NOT NULL CHECK (position >= 0),
  category TEXT NOT NULL, skill TEXT, topic TEXT, difficulty TEXT,
  question_text TEXT NOT NULL, rubric JSONB NOT NULL DEFAULT '{}',
  UNIQUE(interview_id, position), UNIQUE(id, interview_id)
);
CREATE TABLE hiring.interview_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id UUID NOT NULL REFERENCES hiring.interviews(id),
  question_id UUID NOT NULL,
  request_id TEXT NOT NULL,
  answer_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('submitted','skipped')),
  start_offset_ms BIGINT CHECK (start_offset_ms >= 0),
  duration_ms BIGINT CHECK (duration_ms >= 0),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(question_id, interview_id) REFERENCES hiring.interview_questions(id, interview_id),
  UNIQUE(interview_id, question_id), UNIQUE(interview_id, request_id)
);
CREATE TABLE hiring.answer_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  answer_id UUID NOT NULL REFERENCES hiring.interview_answers(id),
  version INT NOT NULL CHECK (version > 0),
  score NUMERIC NOT NULL, maximum_score NUMERIC NOT NULL CHECK (maximum_score > 0),
  model TEXT, prompt_version TEXT, rubric_version TEXT,
  feedback TEXT, rubric_scores JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (score >= 0 AND score <= maximum_score), UNIQUE(answer_id, version)
);
CREATE TABLE hiring.evaluation_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id UUID NOT NULL REFERENCES hiring.answer_evaluations(id),
  reviewer_id TEXT NOT NULL REFERENCES public.users(id),
  score NUMERIC NOT NULL CHECK (score >= 0),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE hiring.scorecards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id UUID NOT NULL REFERENCES hiring.interviews(id),
  version INT NOT NULL CHECK (version > 0),
  overall NUMERIC NOT NULL CHECK (overall BETWEEN 0 AND 100),
  model TEXT, rubric_version TEXT,
  -- Immutable full rendering payload preserves the exact existing report.
  report_snapshot JSONB NOT NULL CHECK (jsonb_typeof(report_snapshot) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(interview_id, version), UNIQUE(id, interview_id)
);
-- Bind exact PDF versions to their rendering snapshot, not just to an interview.
-- An absent row means no verified PDF yet; never substitute a newer report silently.
CREATE TABLE hiring.scorecard_files (
  scorecard_id UUID NOT NULL,
  interview_id UUID NOT NULL,
  file_id UUID NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT 'report' CHECK (category = 'report'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(scorecard_id, file_id),
  FOREIGN KEY(scorecard_id, interview_id) REFERENCES hiring.scorecards(id, interview_id),
  FOREIGN KEY(file_id, interview_id, category) REFERENCES hiring.file_objects(id, interview_id, category)
);
CREATE FUNCTION hiring.reject_history_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Historical records cannot be overwritten; insert a new version'
    USING ERRCODE = '23514';
END $$;
CREATE TRIGGER scorecard_history BEFORE UPDATE ON hiring.scorecards
  FOR EACH ROW EXECUTE FUNCTION hiring.reject_history_update();
CREATE TRIGGER evaluation_history BEFORE UPDATE ON hiring.answer_evaluations
  FOR EACH ROW EXECUTE FUNCTION hiring.reject_history_update();
CREATE FUNCTION hiring.check_review_score() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.score > (SELECT maximum_score FROM hiring.answer_evaluations WHERE id = NEW.evaluation_id) THEN
    RAISE EXCEPTION 'Review score exceeds the original evaluation scale' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER review_score BEFORE INSERT OR UPDATE ON hiring.evaluation_reviews
  FOR EACH ROW EXECUTE FUNCTION hiring.check_review_score();
CREATE TABLE hiring.interview_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id UUID NOT NULL REFERENCES hiring.interviews(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('camera_checks','recording')),
  granted BOOLEAN NOT NULL, notice_version TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE hiring.camera_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id UUID NOT NULL REFERENCES hiring.interviews(id),
  outcome TEXT NOT NULL CHECK (outcome IN ('passed','failed','unable_to_assess')),
  lighting TEXT, positioning TEXT, device_available BOOLEAN,
  detector_version TEXT, checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE hiring.review_events (
  interview_id UUID NOT NULL REFERENCES hiring.interviews(id),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'NO_FACE_SEEN','MULTIPLE_FACES_DETECTED','SIDE_GAZE_LOOKING_AWAY','UNABLE_TO_ASSESS')),
  occurred_at TIMESTAMPTZ NOT NULL,
  start_offset_ms BIGINT NOT NULL CHECK (start_offset_ms >= 0),
  duration_ms BIGINT NOT NULL CHECK (duration_ms >= 0),
  message TEXT, detector_version TEXT,
  PRIMARY KEY(interview_id, event_id),
  CHECK (start_offset_ms + duration_ms <= 86400000)
);
CREATE INDEX review_events_timeline ON hiring.review_events(interview_id, start_offset_ms);
CREATE TABLE hiring.event_explanations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id UUID NOT NULL, event_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  explanation TEXT NOT NULL CHECK (length(explanation) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(interview_id, event_id) REFERENCES hiring.review_events(interview_id, event_id),
  FOREIGN KEY(interview_id, candidate_id) REFERENCES hiring.interviews(id, candidate_id)
);
CREATE TABLE hiring.event_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id UUID NOT NULL, event_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL REFERENCES public.users(id),
  disposition TEXT NOT NULL CHECK (disposition IN ('unreviewed','dismissed','needs_clarification','reviewed')),
  notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(interview_id, event_id) REFERENCES hiring.review_events(interview_id, event_id)
);

-- Transactional outbox coordinates database commits with S3/email/background jobs.
CREATE TABLE hiring.outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT REFERENCES public.organizations(id),
  event_type TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(), locked_until TIMESTAMPTZ,
  last_error_code TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending ON hiring.outbox(available_at) WHERE status IN ('pending','failed');
-- Migration provenance only; archives cannot authorize runtime access.
CREATE TABLE hiring.legacy_records (
  source_table TEXT NOT NULL, source_key TEXT NOT NULL,
  target_table TEXT, target_id TEXT,
  payload JSONB NOT NULL,
  migration_status TEXT NOT NULL CHECK (migration_status IN ('mapped','needs_review')),
  reason TEXT, copied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(source_table, source_key)
);

-- Fail closed until the runtime adapters and role-specific policies are implemented.
-- Migration owner may access; a browser or application login receives NO grants here.
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'hiring' LOOP
    EXECUTE format('ALTER TABLE hiring.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('REVOKE ALL ON hiring.%I FROM PUBLIC', t.tablename);
  END LOOP;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA hiring FROM PUBLIC;

-- PostgreSQL does not create indexes on the referencing side of foreign keys.
CREATE INDEX work_experiences_candidate ON hiring.work_experiences(candidate_id, position);
CREATE INDEX projects_candidate ON hiring.projects(candidate_id, position);
CREATE INDEX certifications_candidate ON hiring.certifications(candidate_id, position);
CREATE INDEX profile_highlights_candidate ON hiring.profile_highlights(candidate_id, kind, position);
CREATE INDEX resume_parses_file ON hiring.resume_parses(file_id, created_at DESC);
CREATE INDEX evaluation_reviews_evaluation ON hiring.evaluation_reviews(evaluation_id, created_at);
CREATE INDEX interview_consents_history ON hiring.interview_consents(interview_id, purpose, recorded_at DESC);
CREATE INDEX camera_checks_interview ON hiring.camera_checks(interview_id, checked_at DESC);
CREATE INDEX event_explanations_event ON hiring.event_explanations(interview_id, event_id, created_at);
CREATE INDEX event_reviews_event ON hiring.event_reviews(interview_id, event_id, created_at);
CREATE INDEX scorecard_files_interview ON hiring.scorecard_files(interview_id);
