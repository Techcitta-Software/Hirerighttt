/**
 * Verify Neon schema matches the Node API.
 * Usage: npm run db:verify  (from repo root)
 */
import pg from 'pg'
import { loadEnv } from '../loadEnv.mjs'
import { EXPECTED_TABLES } from './applySchema.mjs'

loadEnv()

const url = process.env.DATABASE_URL
if (!url) {
  console.error('Set DATABASE_URL in repo-root .env')
  process.exit(1)
}

const ssl = /sslmode=require|neon\.tech|amazonaws\.com/i.test(url)
  ? { rejectUnauthorized: false }
  : undefined

const client = new pg.Client({ connectionString: url, ssl })
await client.connect()

try {
  const res = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  )
  const found = new Set(res.rows.map((r) => r.table_name))
  const missing = EXPECTED_TABLES.filter((t) => !found.has(t))
  const extra = [...found].filter((t) => !EXPECTED_TABLES.includes(t))

  if (missing.length) {
    console.error('[db:verify] Missing tables:', missing.join(', '))
    console.error('Run: npm run db:init')
    process.exit(1)
  }

  console.log('[db:verify] OK — all', EXPECTED_TABLES.length, 'HireRight tables present.')
  if (extra.length) console.log('[db:verify] Extra tables in DB (ignored):', extra.join(', '))

  const counts = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM organizations) AS organizations,
      (SELECT COUNT(*)::int FROM subscription_plans) AS plans,
      (SELECT COUNT(*)::int FROM candidate_talent_profiles) AS talent_index
  `)
  console.log('[db:verify] Row counts:', counts.rows[0])
} finally {
  await client.end()
}
