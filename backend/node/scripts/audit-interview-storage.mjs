import { loadEnv } from '../loadEnv.mjs'
import pg from 'pg'

loadEnv()
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

const cir = await pool.query(`
  SELECT id, candidate_email, started_at, answer_count, status, final_score
  FROM candidate_interview_results
  ORDER BY started_at DESC
`)
const sess = await pool.query(`
  SELECT session_id, email, data->>'startedAt' AS started_at, data->>'status' AS status
  FROM interview_sessions
  ORDER BY session_id DESC
  LIMIT 20
`)
const ir = await pool.query(`
  SELECT email, overall, data->>'completedAt' AS completed_at
  FROM interview_results
  ORDER BY email
`)

console.log('=== candidate_interview_results ===', cir.rowCount)
for (const r of cir.rows) console.log(r)

console.log('\n=== interview_sessions (latest 20) ===', sess.rowCount)
for (const r of sess.rows) console.log(r)

console.log('\n=== interview_results (by email) ===', ir.rowCount)
for (const r of ir.rows) console.log(r)

await pool.end()
