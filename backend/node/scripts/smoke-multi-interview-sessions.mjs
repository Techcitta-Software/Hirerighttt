import { loadEnv } from '../loadEnv.mjs'
import pg from 'pg'

loadEnv()

const base = (process.env.API_URL || 'http://localhost:8787').replace(/\/$/, '')

async function request(path, method = 'GET', body, token) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

const before = await pool.query('SELECT COUNT(*)::int AS c FROM candidate_interview_results')
const countBefore = before.rows[0].c

const login = await request('/api/login', 'POST', {
  email: 'demo@hireright.com',
  password: 'password123',
})
if (login.status !== 200 || !login.data.token) {
  console.error('login failed', login)
  process.exit(1)
}
const token = login.data.token

for (let i = 0; i < 2; i++) {
  const start = await request(
    '/api/interview/start',
    'POST',
    { role: 'Full Stack Engineer', level: '1–3 years' },
    token,
  )
  if (start.status !== 200 || !start.data.sessionId) {
    console.error('start failed', start)
    process.exit(1)
  }
  const sessionId = start.data.sessionId
  const ans = await request(
    '/api/interview/answer',
    'POST',
    {
      sessionId,
      questionIndex: 0,
      question: start.data.question,
      answer: `Multi-session smoke answer ${i + 1} with enough detail for scoring.`,
      skipped: false,
    },
    token,
  )
  if (ans.status !== 202) {
    console.error('answer failed', ans)
    process.exit(1)
  }
  const done = await request('/api/interview/complete', 'POST', { sessionId }, token)
  if (done.status !== 200) {
    console.error('complete failed', done)
    process.exit(1)
  }
  console.log(`session ${i + 1}: ${sessionId}`)
}

const after = await pool.query('SELECT COUNT(*)::int AS c FROM candidate_interview_results')
const countAfter = after.rows[0].c
await pool.end()

if (countAfter < countBefore + 2) {
  console.error('FAIL expected +2 rows', { countBefore, countAfter })
  process.exit(1)
}

console.log('PASS multi-session storage', { countBefore, countAfter })
process.exit(0)
