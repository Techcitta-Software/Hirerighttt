/**
 * Smoke test: LLM, mail status, interview invite API, resume parse.
 * Usage: node scripts/smoke-features.mjs
 */
import { loadEnv } from '../loadEnv.mjs'
import { smtpConfigured } from '../mail.mjs'
import { inviteAccessState } from '../interviewInvites.mjs'
import { parseResumeWithAI } from '../interviewAgent.mjs'

loadEnv()
const base = `http://127.0.0.1:${process.env.PORT || 8787}`

const results = []

function pass(name, detail = '') {
  results.push({ name, ok: true, detail })
  console.log(`✔ ${name}${detail ? ` — ${detail}` : ''}`)
}
function fail(name, detail = '') {
  results.push({ name, ok: false, detail })
  console.error(`✘ ${name}${detail ? ` — ${detail}` : ''}`)
}

// Invite window logic
{
  const t = Date.now()
  const open = inviteAccessState({
    scheduled_start: new Date(t - 10 * 60 * 1000),
    scheduled_end: new Date(t + 50 * 60 * 1000),
  })
  if (open.status === 'open' && open.canStart) pass('invite window (open)')
  else fail('invite window (open)', open.status)

  const early = inviteAccessState({
    scheduled_start: new Date(t + 60 * 60 * 1000),
    scheduled_end: new Date(t + 2 * 60 * 60 * 1000),
  })
  if (early.status === 'too_early') pass('invite window (too early)')
  else fail('invite window (too early)', early.status)
}

pass('smtp env', smtpConfigured() ? 'configured' : 'not configured (add SMTP_* to .env)')

try {
  const health = await fetch(`${base}/api/health`)
  const h = await health.json()
  if (health.ok && h.llm) pass('API health + LLM', h.models?.quality || '')
  else fail('API health', String(health.status))
} catch (e) {
  fail('API health', e.message)
}

try {
  const mail = await fetch(`${base}/api/mail/status`)
  if (mail.status === 404) fail('/api/mail/status', '404 — restart API after code changes')
  else {
    const m = await mail.json()
    if (mail.ok && typeof m.smtpConfigured === 'boolean') pass('/api/mail/status', String(m.smtpConfigured))
    else fail('/api/mail/status', JSON.stringify(m).slice(0, 80))
  }
} catch (e) {
  fail('/api/mail/status', e.message)
}

try {
  const inv = await fetch(`${base}/api/interview-invites/does-not-exist-token`)
  const body = await inv.json()
  if (inv.status === 404 && body.error) pass('invite lookup 404 for bad token')
  else fail('invite lookup', `status ${inv.status}`)
} catch (e) {
  fail('invite lookup', e.message)
}

const sampleResume = `
Jane Doe
Software Engineer · Bengaluru
Email: jane@example.com

EXPERIENCE
Acme Corp — Senior Developer (2021 – Present)
Built React dashboards and Node APIs.

CERTIFICATIONS
AWS Certified Developer — Amazon Web Services — 2023
`

try {
  const parsed = await parseResumeWithAI(sampleResume)
  const hasWork = Array.isArray(parsed?.workExperiences) && parsed.workExperiences.length > 0
  const hasCert = Array.isArray(parsed?.certifications) && parsed.certifications.length > 0
  if (parsed && hasWork && hasCert) pass('resume parse (LLM)', `jobs=${parsed.workExperiences.length} certs=${parsed.certifications.length}`)
  else if (parsed) pass('resume parse (LLM partial)', JSON.stringify(Object.keys(parsed)))
  else fail('resume parse (LLM)', 'null — check GEMINI_API_KEY')
} catch (e) {
  fail('resume parse (LLM)', e.message)
}

// Employer login + invite (demo)
try {
  const login = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'employer@hireright.com', password: 'password123' }),
  })
  const loginBody = await login.json()
  const token = loginBody.token
  if (!login.ok || !token) {
    fail('employer login', loginBody.error || String(login.status))
  } else {
    pass('employer demo login')
    const jobs = await fetch(`${base}/api/vendor/jobs`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    let jobsBody = await jobs.json()
    let job = jobsBody.jobs?.[0]
    if (!job) {
      const created = await fetch(`${base}/api/vendor/jobs`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Smoke Test Engineer',
          jobDescription: 'Node.js and React. Required: JavaScript, PostgreSQL.',
          requiredSkills: ['JavaScript', 'React'],
        }),
      })
      const cBody = await created.json()
      job = cBody.job
      if (!created.ok || !job) {
        fail('vendor create job', cBody.error || String(created.status))
        job = null
      } else pass('vendor create job', job.title)
    }
    if (job) {
      pass('vendor jobs list', job.title)
      let apps = await fetch(`${base}/api/vendor/jobs/${job.id}/applicants`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      let appsBody = await apps.json()
      let app = appsBody.applicants?.[0]
      if (!app && job.shareableCode) {
        const apply = await fetch(`${base}/api/jobs/public/${job.shareableCode}/apply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            candidateName: 'Smoke Applicant',
            candidateEmail: `smoke.${Date.now()}@example.test`,
            candidatePhone: '919876543210',
            experienceYears: '3 years',
            resumeText: sampleResume,
            resumeName: 'smoke.txt',
          }),
        })
        const applyBody = await apply.json()
        if (apply.ok) {
          pass('public job apply')
          apps = await fetch(`${base}/api/vendor/jobs/${job.id}/applicants`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          appsBody = await apps.json()
          app = appsBody.applicants?.[0]
        } else fail('public job apply', applyBody.error || String(apply.status))
      }
      if (!app) {
        pass('interview invite API', 'skipped — no applicants')
      } else {
        const start = new Date(Date.now() + 30 * 60 * 1000).toISOString()
        const inviteRes = await fetch(`${base}/api/vendor/applicants/${app.id}/interview-invite`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ scheduledStart: start, durationMinutes: 60 }),
        })
        const inviteBody = await inviteRes.json()
        if (inviteRes.ok && inviteBody.invite?.inviteUrl) {
          pass('interview invite API', inviteBody.invite.emailSent ? 'email sent' : 'link only (no SMTP)')
          const tokenPart = inviteBody.invite.inviteUrl.split('/').pop()
          const pub = await fetch(`${base}/api/interview-invites/${tokenPart}`)
          const pubBody = await pub.json()
          if (pub.ok && pubBody.invite?.token) pass('public invite fetch')
          else fail('public invite fetch', JSON.stringify(pubBody).slice(0, 100))
        } else fail('interview invite API', inviteBody.error || String(inviteRes.status))
      }
    }
  }
} catch (e) {
  fail('employer flow', e.message)
}

const failed = results.filter((r) => !r.ok)
console.log('\n---')
console.log(`Smoke: ${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
