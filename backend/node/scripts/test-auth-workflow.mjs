/**
 * application-dev.md verification: signup, duplicate, login, resume upload auth.
 * Usage: node backend/node/scripts/test-auth-workflow.mjs
 */
import { loadEnv } from '../loadEnv.mjs'

loadEnv()

const base = `http://127.0.0.1:${process.env.PORT || 8787}`

async function req(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const data = await res.json().catch(() => ({}))
  return { res, data }
}

const health = await req('/api/health')
if (!health.res.ok) {
  console.error('[auth-workflow] API not running at', base)
  process.exit(1)
}

const stamp = Date.now()
const email = `workflow.${stamp}@example.test`
const password = 'WorkflowTest1!'
const phone = `+9198${String(stamp).slice(-8)}`

let { res: signupRes, data: signupData } = await req('/api/signup', {
  method: 'POST',
  body: {
    name: 'Workflow Test',
    email,
    password,
    phone,
    role: 'jobseeker',
  },
})
if (signupRes.status !== 201 || !signupData.token) {
  console.error('[auth-workflow] signup failed', signupRes.status, signupData.error)
  process.exit(1)
}
console.log('[auth-workflow] signup OK')

const dup = await req('/api/signup', {
  method: 'POST',
  body: { name: 'Dup', email, password, phone, role: 'jobseeker' },
})
if (dup.res.status !== 409) {
  console.error('[auth-workflow] expected 409 duplicate, got', dup.res.status)
  process.exit(1)
}
console.log('[auth-workflow] duplicate signup 409 OK')

const badLogin = await req('/api/login', {
  method: 'POST',
  body: { email, password: 'wrong-password' },
})
if (badLogin.res.status !== 401) {
  console.error('[auth-workflow] expected 401 bad login, got', badLogin.res.status)
  process.exit(1)
}
console.log('[auth-workflow] bad login 401 OK')

const login = await req('/api/login', { method: 'POST', body: { email, password } })
if (login.res.status !== 200 || !login.data.token) {
  console.error('[auth-workflow] login failed', login.res.status, login.data.error)
  process.exit(1)
}
console.log('[auth-workflow] login OK')

const noAuthUpload = await req('/api/resume/upload', {
  method: 'POST',
  body: { filename: 'resume.pdf', file_base64: Buffer.from('%PDF-1.4').toString('base64') },
})
if (noAuthUpload.res.status !== 401) {
  console.error('[auth-workflow] resume upload without token should 401, got', noAuthUpload.res.status)
  process.exit(1)
}
console.log('[auth-workflow] resume upload 401 without auth OK')

const tinyPdf = Buffer.from('%PDF-1.4\n').toString('base64')
const upload = await req('/api/resume/upload', {
  method: 'POST',
  token: login.data.token,
  body: { filename: 'resume.pdf', file_base64: tinyPdf },
})
if (upload.res.status === 200 && upload.data.storagePath) {
  console.log(
    '[auth-workflow] resume upload OK',
    upload.data.storageProvider || 'unknown',
    upload.data.storagePath,
  )
} else if (upload.res.status === 503 && upload.data.skipped) {
  console.log('[auth-workflow] storage skipped — set S3_BUCKET + AWS_REGION or Supabase in .env')
} else {
  console.warn('[auth-workflow] resume upload:', upload.res.status, upload.data.error || upload.data)
}

console.log('[auth-workflow] All required checks passed.')
