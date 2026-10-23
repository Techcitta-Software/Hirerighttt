/**
 * Wipe Neon data except subscription plans, org-platform scaffold, and three demo logins.
 *
 * Usage (repo root):
 *   CONFIRM_PURGE=yes node backend/node/scripts/purge-keep-demo-accounts.mjs
 */
import { loadEnv } from '../loadEnv.mjs'
import pg from 'pg'
import { ensureDemoUsersInDb, DEMO_SEED_USERS } from '../demoAccounts.mjs'
import { loadDb, saveDb } from '../db/store.mjs'

loadEnv()

const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) {
  console.error('[purge-demos] DATABASE_URL is required (repo-root .env).')
  process.exit(1)
}

if (process.env.CONFIRM_PURGE !== 'yes') {
  console.error(
    '[purge-demos] Refusing to run without CONFIRM_PURGE=yes\n' +
      '  Deletes all users/jobs/applications except demo@, employer@, admin@ (re-seeded after wipe).',
  )
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })

async function truncateOptional(client, table) {
  try {
    await client.query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`)
  } catch (err) {
    if (err?.code !== '42P01') throw err
  }
}

async function runSqlPurge(client) {
  for (const legacy of ['candidate_interview_results', 'candidates']) {
    await truncateOptional(client, legacy)
  }
  await truncateOptional(client, 'interview_artifacts')
  await truncateOptional(client, 'interview_recordings')
  await truncateOptional(client, 'stored_files')

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
}

async function run() {
  const client = await pool.connect()
  try {
    await runSqlPurge(client)
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw err
  } finally {
    client.release()
  }

  let db = await loadDb(databaseUrl)
  const { db: withDemos, changed } = await ensureDemoUsersInDb(db)
  db = withDemos
  if (changed) {
    await saveDb(db, databaseUrl)
  } else {
    await saveDb(db, databaseUrl)
  }

  const demoEmails = DEMO_SEED_USERS.map((d) => d.email)
  const counts = await pool.query(
    `
    SELECT
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM jobs) AS jobs,
      (SELECT COUNT(*)::int FROM employer_applications) AS applications,
      (SELECT COUNT(*)::int FROM organizations) AS organizations
    `,
  )
  const users = await pool.query(
    `SELECT email FROM users ORDER BY email`,
  )

  console.log('[purge-demos] Done. Row counts:', counts.rows[0])
  console.log('[purge-demos] Users remaining:', users.rows.map((r) => r.email).join(', '))
  console.log('[purge-demos] Expected demos:', demoEmails.join(', '))
  await pool.end()
}

run().catch((err) => {
  console.error('[purge-demos] Failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
