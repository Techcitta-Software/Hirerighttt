import { loadEnv } from '../loadEnv.mjs'
import pg from 'pg'

loadEnv()
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

const users = await pool.query('SELECT id, email, name, role, created_at FROM users ORDER BY created_at')
const sessions = await pool.query(
  'SELECT email, COUNT(*)::int AS tokens, MAX(expires_at) AS latest_expiry FROM hireright_sessions GROUP BY email',
)
const cir = await pool.query('SELECT COUNT(*)::int AS c FROM candidate_interview_results')

console.log('users', users.rows)
console.log('sessions', sessions.rows)
console.log('candidate_interview_results', cir.rows[0].c)
await pool.end()
