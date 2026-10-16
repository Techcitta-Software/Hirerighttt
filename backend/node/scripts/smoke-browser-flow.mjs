import { loadEnv } from '../loadEnv.mjs'
import pg from 'pg'

loadEnv()

const base = (process.env.API_URL || 'http://localhost:5173').replace(/\/$/, '')

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

function fail(step, detail) {
  console.error(`FAIL at ${step}:`, JSON.stringify(detail))
  process.exit(1)
}

const noAuth = await request('/api/interview/start', 'POST', { role: 'Full Stack Engineer' })
if (noAuth.status !== 401) fail('start without token should be 401', noAuth)
const stale = await request('/api/interview/start', 'POST', { role: 'Full Stack Engineer' }, 'deadbeef')
if (stale.status !== 401) fail('start with stale token should be 401', stale)
console.log('ok: unauthenticated and stale-token starts return 401')

const stamp = Date.now().toString().slice(-9)
const email = `e2e.${stamp}@example.test`
const signup = await request('/api/signup', 'POST', {
  name: 'E2E Candidate',
  email,
  password: 'e2e-password-123',
  phone: `+91 9${stamp}`,
  role: 'jobseeker',
})
if (signup.status !== 201 || !signup.data.token) fail('signup', signup)
const token = signup.data.token
console.log(`ok: signed up ${email}`)

const me = await request('/api/candidates/me', 'GET', undefined, token)
if (me.status !== 200 || me.data.candidate?.email !== email) fail('candidates row after signup', me)
console.log('ok: candidates row created at signup')

const start = await request(
  '/api/interview/start',
  'POST',
  { role: 'Full Stack Engineer', level: '1–3 years' },
  token,
)
if (start.status !== 200 || !start.data.sessionId) fail('interview/start', start)
const sessionId = start.data.sessionId
console.log(`ok: interview started ${sessionId}`)

const answers = [
  'I built REST APIs in Node.js with PostgreSQL, added indexes that cut query time by half, and wrote integration tests.',
  'I would profile the slow endpoint, add caching with Redis, and monitor latency after the change.',
]
let question = start.data.question
for (let i = 0; i < answers.length; i++) {
  const ans = await request(
    '/api/interview/answer',
    'POST',
    { sessionId, questionIndex: i, question, answer: answers[i], skipped: false },
    token,
  )
  if (ans.status !== 202) fail(`answer ${i}`, ans)
  const next = await request(
    '/api/interview/next',
    'POST',
    { sessionId, lastQuestion: question, lastAnswer: answers[i] },
    token,
  )
  if (next.status !== 200 || !next.data.question) fail(`next question ${i}`, next)
  question = next.data.question
}
console.log('ok: 2 answers stored (202) and next questions generated')

const done = await request('/api/interview/complete', 'POST', { sessionId }, token)
if (done.status !== 200 || !done.data.result) fail('complete', done)

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})
const { rows } = await pool.query(
  `SELECT candidate_name, candidate_email, status, answer_count, scored_count, final_score,
          jsonb_agg(q->'evaluation'->>'status') AS eval_statuses
   FROM candidate_interview_results r, jsonb_array_elements(r.qa_pairs) q
   WHERE r.id = $1
   GROUP BY candidate_name, candidate_email, status, answer_count, scored_count, final_score`,
  [sessionId],
)
await pool.end()
const row = rows[0]
if (!row) fail('neon row', 'no candidate_interview_results row')
if (row.candidate_email !== email || row.status !== 'completed' || row.answer_count !== 2) fail('neon row values', row)
if (row.scored_count !== 2 || row.final_score == null) fail('neon scoring', row)
console.log('ok: Neon row', row)
console.log('PASS browser-flow e2e')
process.exit(0)
