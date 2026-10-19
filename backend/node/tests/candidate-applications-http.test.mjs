import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const url = process.env.DATABASE_URL

test('public apply writes employer_applications and job_applications', { skip: !url, timeout: 120000 }, async () => {
  const parsed = new URL(url)
  assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname))
  const schema = `cand_apps_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Client({ connectionString: url })
  await admin.connect()
  await admin.query(`CREATE SCHEMA ${schema}`)
  parsed.searchParams.set('options', `-c search_path=${schema}`)
  const port = String(55442 + Math.floor(Math.random() * 200))
  const child = spawn(process.execPath, ['index.mjs'], {
    cwd: new URL('../', import.meta.url),
    windowsHide: true,
    env: {
      ...process.env,
      DATABASE_URL: parsed.toString(),
      PORT: port,
      NODE_ENV: 'production',
      ENVIRONMENT: 'production',
      ALLOW_DEMO_ACCOUNTS: 'false',
      SESSION_SECRET: 'test-session-secret-at-least-32-characters',
      STRICT_PRODUCTION_CONFIG: 'false',
      GEMINI_API_KEY: '',
      OPENAI_API_KEY: '',
      OPENROUTER_API_KEY: '',
      LLM_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.resume()
  child.stderr.resume()
  const base = `http://127.0.0.1:${port}`

  async function request(path, method = 'GET', body, token) {
    const response = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const data = await response.json().catch(() => ({}))
    return { status: response.status, data }
  }

  const resume =
    'Senior engineer with eight years building React and Node platforms. Led migration to microservices.'

  try {
    let ready = false
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error('API exited before startup')
      try {
        if ((await request('/api/plans')).status === 200) {
          ready = true
          break
        }
      } catch {
        // retry
      }
      await new Promise((r) => setTimeout(r, 120))
    }
    assert.ok(ready, 'API did not start')

    const empEmail = `emp-${randomUUID()}@example.test`
    const empSignup = await request('/api/signup', 'POST', {
      name: 'Employer',
      email: empEmail,
      password: 'ExamplePass123!',
      role: 'employer',
      companyName: 'Acme Corp',
      phone: '+15550003001',
    })
    assert.equal(empSignup.status, 201)
    const empToken = empSignup.data.token

    const jobRes = await request('/api/vendor/jobs', 'POST', {
      title: 'Full Stack Engineer',
      jobDescription: resume + ' Need React TypeScript Node PostgreSQL experience.',
      roleTrack: 'Full Stack',
      experienceLevel: '3-5 years',
      location: 'Remote',
      requiredSkills: ['React', 'TypeScript', 'Node.js'],
      company: 'Acme Corp',
    }, empToken)
    assert.equal(jobRes.status, 201)
    const job = jobRes.data.job

    const candEmail = `cand-${randomUUID()}@example.test`
    const candSignup = await request('/api/signup', 'POST', {
      name: 'Candidate',
      email: candEmail,
      password: 'ExamplePass123!',
      role: 'jobseeker',
      phone: '+15550003002',
    })
    assert.equal(candSignup.status, 201)
    const candToken = candSignup.data.token

    const applyPath = `/api/jobs/public/${job.companySlug}/${job.shareableCode}/apply`
    const applied = await request(applyPath, 'POST', {
      candidateName: 'Candidate',
      candidateEmail: candEmail,
      resumeText: resume,
      resumeName: 'profile.txt',
      match: 87,
      attachInterviewReport: false,
    }, candToken)
    assert.equal(applied.status, 201)
    assert.ok(applied.data.applicationId)
    assert.equal(applied.data.candidateApplication.jobId, job.id)
    assert.equal(applied.data.candidateApplication.title, job.title)

    const listed = await request('/api/applications', 'GET', undefined, candToken)
    assert.equal(listed.status, 200)
    assert.equal(listed.data.applications.length, 1)
    assert.equal(listed.data.applications[0].jobId, job.id)

    const empRow = await admin.query(
      `SELECT id, job_id FROM ${schema}.employer_applications WHERE candidate_email = $1`,
      [candEmail],
    )
    assert.equal(empRow.rowCount, 1)

    const candRow = await admin.query(
      `SELECT id, data FROM ${schema}.job_applications WHERE lower(email) = lower($1)`,
      [candEmail],
    )
    assert.equal(candRow.rowCount, 1)
    assert.equal(candRow.rows[0].data.jobId, job.id)
    assert.equal(candRow.rows[0].data.title, 'Full Stack Engineer')

    const markDeleted = await request(
      `/api/vendor/jobs/${job.id}/mark-deleted-for-candidates`,
      'POST',
      {},
      empToken,
    )
    assert.equal(markDeleted.status, 200)
    assert.equal(markDeleted.data.candidateApplicationsUpdated, 1)

    const listedAfterDelete = await request('/api/applications', 'GET', undefined, candToken)
    assert.equal(listedAfterDelete.data.applications[0].jobStatus, 'deleted')

    const candRowAfter = await admin.query(
      `SELECT data FROM ${schema}.job_applications WHERE lower(email) = lower($1)`,
      [candEmail],
    )
    assert.equal(candRowAfter.rows[0].data.jobStatus, 'deleted')

    const withdraw = await request(`/api/applications/${applied.data.applicationId}`, 'DELETE', undefined, candToken)
    assert.equal(withdraw.status, 200)
    assert.equal(withdraw.data.applications.length, 0)
  } finally {
    child.kill('SIGTERM')
    await new Promise((r) => setChildExit(child, r))
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await admin.end()
  }
})

function setChildExit(child, resolve) {
  if (child.exitCode !== null) {
    resolve()
    return
  }
  child.once('exit', () => resolve())
  setTimeout(() => {
    try {
      child.kill('SIGKILL')
    } catch {
      // ignore
    }
    resolve()
  }, 5000)
}
