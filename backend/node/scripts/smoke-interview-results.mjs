import { loadEnv } from '../loadEnv.mjs'

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

function fail(step, detail) {
  console.error(`FAIL at ${step}:`, detail)
  process.exit(1)
}

const login = await request('/api/login', 'POST', {
  email: 'demo@hireright.com',
  password: 'password123',
})
if (login.status !== 200 || !login.data.token) fail('login', login)
const token = login.data.token

const me = await request('/api/candidates/me', 'GET', undefined, token)
if (me.status !== 200 || !me.data.candidate) fail('candidates/me', me)
const cand = me.data.candidate
if (!cand.email) fail('candidate email', cand)
const skills = cand.resumeSkills ?? cand.resume_skills
if (skills != null && !Array.isArray(skills)) fail('resume skills', skills)
if ('password_hash' in cand || 'passwordHash' in cand) fail('password leaked', cand)

const start = await request(
  '/api/interview/start',
  'POST',
  { role: 'Full Stack Engineer', level: '1–3 years' },
  token,
)
if (start.status !== 200 || !start.data.sessionId) fail('interview/start', start)
const sessionId = start.data.sessionId

const answerText =
  'I built a React dashboard with TypeScript, optimized API calls with caching, and reduced load time by thirty percent using profiling and code splitting in production.'
const t0 = Date.now()
const ans = await request(
  '/api/interview/answer',
  'POST',
  {
    sessionId,
    questionIndex: 0,
    question: start.data.question,
    answer: answerText,
    skipped: false,
  },
  token,
)
const latency = Date.now() - t0
if (ans.status !== 202) fail('interview/answer', ans)
console.log(`answer stored in ${latency}ms (expect <1500ms)`)

const skip = await request(
  '/api/interview/answer',
  'POST',
  {
    sessionId,
    questionIndex: 1,
    question: { text: 'Follow-up question?', category: 'Technical' },
    answer: '',
    skipped: true,
  },
  token,
)
if (skip.status !== 202) fail('interview/answer skip', skip)

let score0 = null
const pollStart = Date.now()
while (Date.now() - pollStart < 15000) {
  const got = await request(`/api/interview/results/${sessionId}`, 'GET', undefined, token)
  if (got.status === 200 && got.data.result?.qaPairs?.length) {
    const p0 = got.data.result.qaPairs.find((p) => p.questionIndex === 0)
    if (p0?.evaluation?.status && p0.evaluation.status !== 'pending') {
      score0 = p0.evaluation.score
      console.log(`Q0 scored as ${score0} (${p0.evaluation.status}) after ${Date.now() - pollStart}ms`)
      break
    }
  }
  await new Promise((r) => setTimeout(r, 500))
}
if (score0 == null) fail('poll scoring', 'timeout waiting for evaluation')

const done = await request('/api/interview/complete', 'POST', { sessionId, status: 'completed' }, token)
if (done.status !== 200 || !done.data.result) fail('interview/complete', done)
const final = done.data.result.finalScore
const expected = Math.round((Number(score0) + 0) / 2)
if (final !== expected) fail('final_score', { final, expected, score0 })

console.log('PASS smoke-interview-results')
process.exit(0)
