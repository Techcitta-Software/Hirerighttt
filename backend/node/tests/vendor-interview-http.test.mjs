import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { AI_ENGINEER_JD, FULL_STACK_RESUME } from './fixtures/vendorJd.mjs'

const url = process.env.DATABASE_URL

test('vendor JD interview HTTP flow', { skip: !url, timeout: 120000 }, async () => {
  const parsed = new URL(url)
  assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname))
  const schema = `vendor_iv_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Client({ connectionString: url })
  await admin.connect()
  await admin.query(`CREATE SCHEMA ${schema}`)
  parsed.searchParams.set('options', `-c search_path=${schema}`)
  const child = spawn(process.execPath, ['index.mjs'], {
    cwd: new URL('../', import.meta.url),
    windowsHide: true,
    env: {
      ...process.env,
      DATABASE_URL: parsed.toString(),
      PORT: '55441',
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
  const base = 'http://127.0.0.1:55441'

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

    const vendorSignup = await request('/api/signup', 'POST', {
      name: 'Vendor User',
      email: `vendor-${randomUUID()}@example.test`,
      password: 'ExamplePass123!',
      role: 'employer',
      companyName: 'Acme AI Hiring',
      phone: '+15550001001',
    })
    assert.equal(vendorSignup.status, 201)
    const vendorToken = vendorSignup.data.token

    const jobRes = await request(
      '/api/vendor/jobs',
      'POST',
      {
        title: 'AI Engineer',
        roleTrack: 'AI Engineer',
        experienceLevel: '3-5 years',
        jobDescription: AI_ENGINEER_JD,
        requiredSkills: ['Python', 'LangChain', 'RAG', 'PyTorch'],
        company: 'Acme AI Hiring',
      },
      vendorToken,
    )
    assert.equal(jobRes.status, 201)
    const job = jobRes.data.job
    assert.ok(job.shareableCode)

    const candEmail = `cand-${randomUUID()}@example.test`
    const candSignup = await request('/api/signup', 'POST', {
      name: 'Jane Candidate',
      email: candEmail,
      password: 'ExamplePass123!',
      role: 'jobseeker',
      phone: '+15550001002',
    })
    assert.equal(candSignup.status, 201)
    const candToken = candSignup.data.token

    await request(
      '/api/profile',
      'PUT',
      {
        resumeText: FULL_STACK_RESUME,
        skills: ['React', 'TypeScript', 'Node.js'],
        fullName: 'Jane Candidate',
      },
      candToken,
    )

    const applyPath = `/api/jobs/public/${job.companySlug}/${job.shareableCode}/apply`
    const applied = await request(applyPath, 'POST', {
      candidateName: 'Jane Candidate',
      candidateEmail: candEmail,
      candidatePhone: '+15550001002',
      experienceYears: '5',
      resumeText: FULL_STACK_RESUME,
      resumeName: 'resume.txt',
    })
    assert.equal(applied.status, 201)
    const applicationId = applied.data.applicationId
    assert.ok(applicationId)

    const start = await request(
      '/api/interview/start',
      'POST',
      { applicationId, role: 'ignored', level: 'ignored' },
      candToken,
    )
    assert.equal(start.status, 200)
    assert.equal(start.data.questionMode, 'vendor_jd')
    assert.ok(start.data.question?.jdAnchor)
    assert.ok(
      AI_ENGINEER_JD.toLowerCase().includes(String(start.data.question.jdAnchor).toLowerCase()) ||
        start.data.question.text.length > 20,
    )

    const sessionId = start.data.sessionId
    for (let i = 0; i < 4; i++) {
      const next = await request(
        '/api/interview/next',
        'POST',
        {
          sessionId,
          lastAnswer: 'I led a project delivering measurable outcomes for users and stakeholders.',
          lastQuestion: start.data.question,
          jobDescription: 'Totally unrelated JD about underwater basket weaving only.',
        },
        candToken,
      )
      assert.equal(next.status, 200)
      assert.ok(next.data.question?.jdAnchor)
      const anchor = String(next.data.question.jdAnchor).toLowerCase()
      assert.ok(
        AI_ENGINEER_JD.toLowerCase().includes(anchor) ||
          /rag|langchain|pytorch|llm|embedding|mlops|python|vector|hugging/i.test(
            next.data.question.text.toLowerCase(),
          ),
      )
    }

    const otherSignup = await request('/api/signup', 'POST', {
      name: 'Other Candidate',
      email: `other-${randomUUID()}@example.test`,
      password: 'ExamplePass123!',
      role: 'jobseeker',
      phone: '+15550001003',
    })
    const forbidden = await request(
      '/api/interview/start',
      'POST',
      { applicationId },
      otherSignup.data.token,
    )
    assert.equal(forbidden.status, 403)
  } finally {
    child.kill('SIGTERM')
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
  }
})
