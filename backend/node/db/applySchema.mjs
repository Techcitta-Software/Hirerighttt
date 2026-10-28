import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** SQL files applied in order on every Neon connect / db:init */
export const SCHEMA_FILES = [
  'schema.sql',
  'schema-talent-search.sql',
  'schema-assessment.sql',
  'schema-interview-invites.sql',
  'schema-files.sql',
  'schema-role-skills.sql',
]

export function readAllSchemaSql() {
  return SCHEMA_FILES.map((file) => readFileSync(join(__dirname, file), 'utf8')).join('\n')
}

/** @param {import('pg').Pool | import('pg').PoolClient} db */
export async function applySchema(db) {
  await db.query(readAllSchemaSql())
}

export const EXPECTED_TABLES = [
  'subscription_plans',
  'organizations',
  'organization_subscriptions',
  'hireright_sessions',
  'users',
  'organization_members',
  'organization_invites',
  'profiles',
  'jobs',
  'employer_applications',
  'job_applications',
  'interview_results',
  'interview_result_history',
  'interview_sessions',
  'confidential_candidates',
  'audit_logs',
  'candidate_talent_profiles',
  'organization_talent_access',
  'recruiter_saved_searches',
  'interview_invites',
  'assessment_jobs', 'assessment_resumes', 'interview_plans', 'interview_questions',
  'assessment_sessions', 'interview_answers', 'answer_evaluations', 'recruiter_reviews',
  'interview_reports', 'assessment_events', 'assessment_usage',
  'personalized_interview_links',
  'stored_files',
  'interview_recordings',
  'interview_artifacts',
  'role_skill_library',
]
