/**
 * Wipe all candidate, employer, and demo data from Neon.
 * Keeps subscription_plans and the platform org scaffold (org-platform).
 *
 * Usage (repo root):
 *   CONFIRM_PURGE=yes node backend/node/scripts/purge-all-data.mjs
 */
import { loadEnv } from '../loadEnv.mjs'
import pg from 'pg'

loadEnv()

const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) {
  console.error('[purge] DATABASE_URL is required (repo-root .env).')
  process.exit(1)
}

if (process.env.CONFIRM_PURGE !== 'yes') {
  console.error(
    '[purge] Refusing to run without CONFIRM_PURGE=yes\n' +
      '  This deletes ALL users, jobs, applications, interviews, vault rows, and sessions.',
  )
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })

async function run() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(`
      TRUNCATE TABLE
        recruiter_reviews,
        answer_evaluations,
        interview_answers,
        interview_reports,
        personalized_interview_links,
        assessment_events,
        assessment_sessions,
        interview_questions,
        interview_plans,
        assessment_resumes,
        assessment_jobs,
        assessment_usage
      RESTART IDENTITY CASCADE
    `)

    await client.query(`
      TRUNCATE TABLE
        interview_invites,
        employer_applications,
        job_applications,
        interview_result_history,
        interview_results,
        interview_sessions,
        confidential_candidates,
        candidate_talent_profiles,
        organization_talent_access,
        jobs,
        recruiter_saved_searches,
        organization_invites,
        audit_logs,
        hireright_sessions,
        profiles
      RESTART IDENTITY CASCADE
    `)

    await client.query(`DELETE FROM organization_members WHERE organization_id <> 'org-platform'`)
    await client.query(`DELETE FROM organization_subscriptions WHERE organization_id <> 'org-platform'`)
    await client.query(`DELETE FROM organizations WHERE id <> 'org-platform'`)
    await client.query(`DELETE FROM users`)

    await client.query(`
      INSERT INTO organizations (id, name, slug, status, settings)
      VALUES ('org-platform', 'HireRight Platform', 'hireright-platform', 'active', '{"is_platform":true}'::jsonb)
      ON CONFLICT (id) DO NOTHING
    `)
    await client.query(`
      INSERT INTO organization_subscriptions (id, organization_id, plan_id, status)
      VALUES ('sub-platform', 'org-platform', 'plan-enterprise', 'active')
      ON CONFLICT (organization_id) DO NOTHING
    `)

    await client.query('COMMIT')

    const counts = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM users) AS users,
        (SELECT COUNT(*)::int FROM jobs) AS jobs,
        (SELECT COUNT(*)::int FROM employer_applications) AS applications,
        (SELECT COUNT(*)::int FROM confidential_candidates) AS vault,
        (SELECT COUNT(*)::int FROM candidate_talent_profiles) AS talent_index,
        (SELECT COUNT(*)::int FROM organizations) AS organizations
    `)
    console.log('[purge] Done. Remaining row counts:', counts.rows[0])
    console.log('[purge] New signups start with an empty database (platform org only).')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

run().catch((err) => {
  console.error('[purge] Failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
