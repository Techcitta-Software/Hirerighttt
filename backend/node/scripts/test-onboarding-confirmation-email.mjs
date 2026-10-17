/**
 * End-to-end: jobseeker signup → POST /api/interview/confirmation-email
 *
 * Usage (API running on PORT, default 8787):
 *   node backend/node/scripts/test-onboarding-confirmation-email.mjs
 *   CONFIRM_EMAIL_TEST_TO=you@example.com node backend/node/scripts/test-onboarding-confirmation-email.mjs
 */
import { loadEnv } from '../loadEnv.mjs'

loadEnv()

const base = `http://127.0.0.1:${process.env.PORT || 8787}`
const recipient = process.env.CONFIRM_EMAIL_TEST_TO?.trim() || process.env.MAIL_TEST_TO?.trim()

async function jsonFetch(path, { method = 'GET', body, token } = {}) {
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

const health = await jsonFetch('/api/health')
if (!health.res.ok) {
  console.error('[confirm-email:test] API not reachable at', base, '— start npm run dev:all')
  process.exit(1)
}

const email =
  recipient ||
  `onboarding.confirm.${Date.now()}@example.test`
const password = 'TestConfirmEmail1!'

let { res: signupRes, data: signupData } = await jsonFetch('/api/signup', {
  method: 'POST',
  body: {
    name: 'Onboarding Email Test',
    email,
    password,
    role: 'jobseeker',
    phone: '+919876543210',
  },
})

let token = signupData.token
if (signupRes.status === 409) {
  const login = await jsonFetch('/api/login', {
    method: 'POST',
    body: { email, password },
  })
  token = login.data.token
  if (!login.res.ok || !token) {
    console.error('[confirm-email:test] login failed:', login.data.error || login.res.status)
    process.exit(1)
  }
} else if (!signupRes.ok || !token) {
  console.error('[confirm-email:test] signup failed:', signupData.error || signupRes.status)
  process.exit(1)
}

const scheduledStart = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
const { res, data } = await jsonFetch('/api/interview/confirmation-email', {
  method: 'POST',
  token,
  body: {
    scheduledStart,
    durationMinutes: 60,
    jobTitle: 'HireRight AI Interview',
    roleTrack: 'Software Engineer',
  },
})

console.log('[confirm-email:test] POST status:', res.status)
console.log('[confirm-email:test] Response:', {
  ok: data.ok,
  emailSent: data.emailSent,
  emailError: data.emailError,
  inviteUrl: data.inviteUrl ? `${data.inviteUrl.slice(0, 48)}…` : null,
  smtpConfigured: data.smtpConfigured,
})

if (res.status === 503) {
  console.error('[confirm-email:test] SMTP not configured on server.')
  process.exit(1)
}
if (!data.inviteUrl) {
  console.error('[confirm-email:test] No invite URL returned.')
  process.exit(1)
}
if (!data.emailSent) {
  console.error('[confirm-email:test] Email was not sent:', data.emailError || 'unknown')
  process.exit(1)
}

console.log('[confirm-email:test] OK — confirmation email sent to', email)
if (!recipient) {
  console.log(
    '[confirm-email:test] Tip: set CONFIRM_EMAIL_TEST_TO=your@inbox.com to deliver to a real mailbox.',
  )
}
