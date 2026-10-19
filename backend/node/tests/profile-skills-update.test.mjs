import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const url = process.env.DATABASE_URL

test('PUT /api/profile updates candidate_talent_profiles skills', { skip: !url, timeout: 120000 }, async () => {
  const parsed = new URL(url)
  assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname))
  const schema = `profile_sk_${randomUUID().replaceAll('-', '')}`
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

    const email = `skills-${randomUUID()}@example.test`
    const signup = await request('/api/signup', 'POST', {
      name: 'Skills Tester',
      email,
      password: 'ExamplePass123!',
      role: 'jobseeker',
      phone: '+15550001999',
    })
    assert.equal(signup.status, 201)
    const token = signup.data.token
    const userId = signup.data.user.id

    const updatedSkills = ['React', 'TypeScript', 'Neon', 'Docker']
    const put = await request(
      '/api/profile',
      'PUT',
      {
        skills: updatedSkills,
        fullName: 'Skills Tester',
        currentRole: 'Software Engineer',
        currentLocation: 'Hyderabad',
      },
      token,
    )
    assert.equal(put.status, 200)
    assert.deepEqual(put.data.profile.skills, updatedSkills)

    let row = await admin.query(
      `SELECT skills, full_name, location, current_role, experience_years
       FROM ${schema}.candidate_talent_profiles WHERE user_id = $1`,
      [userId],
    )
    assert.equal(row.rowCount, 1)
    assert.deepEqual(row.rows[0].skills, updatedSkills)
    assert.equal(row.rows[0].full_name, 'Skills Tester')
    assert.equal(row.rows[0].location, 'Hyderabad')
    assert.equal(row.rows[0].current_role, 'Software Engineer')

    const putBasicsRole = await request(
      '/api/profile',
      'PUT',
      {
        skills: updatedSkills,
        fullName: 'Updated Name',
        currentRole: 'Staff Engineer',
        currentLocation: 'Bengaluru',
        totalExperience: '5+ years',
        currentCompanyTitle: 'Acme Corp, Lead',
        highestEducation: 'M.Tech',
      },
      token,
    )
    assert.equal(putBasicsRole.status, 200)
    assert.equal(putBasicsRole.data.profile.fullName, 'Updated Name')
    assert.equal(putBasicsRole.data.profile.currentCompanyTitle, 'Acme Corp, Lead')

    row = await admin.query(
      `SELECT full_name, location, current_role, experience_years
       FROM ${schema}.candidate_talent_profiles WHERE user_id = $1`,
      [userId],
    )
    assert.equal(row.rows[0].full_name, 'Updated Name')
    assert.equal(row.rows[0].location, 'Bengaluru')
    assert.equal(row.rows[0].current_role, 'Staff Engineer')
    assert.equal(row.rows[0].experience_years, '5+ years')
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
