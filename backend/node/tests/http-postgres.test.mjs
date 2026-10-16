import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const url = process.env.ASSESSMENT_TEST_DATABASE_URL
test('HTTP auth, vault isolation and invalid request handling', { skip: !url, timeout: 30000 }, async () => {
  const parsed = new URL(url)
  assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname))
  const schema = `http_${randomUUID().replaceAll('-', '')}`
  const admin = new pg.Client({ connectionString: url })
  await admin.connect()
  await admin.query(`CREATE SCHEMA ${schema}`)
  parsed.searchParams.set('options', `-c search_path=${schema}`)
  const child = spawn(process.execPath, ['backend/node/index.mjs'], {
    cwd: new URL('../../../', import.meta.url), windowsHide: true,
    env: { ...process.env, DATABASE_URL: parsed.toString(), PORT: '55440', NODE_ENV: 'production', ENVIRONMENT: 'production', ALLOW_DEMO_ACCOUNTS: 'false', SESSION_SECRET: 'test-session-secret-at-least-32-characters', STRICT_PRODUCTION_CONFIG: 'false', GEMINI_API_KEY: '', OPENAI_API_KEY: '', OPENROUTER_API_KEY: '', LLM_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  // Do not include application logs in test failures; they can contain operational details.
  child.stdout.resume(); child.stderr.resume()
  const base = 'http://127.0.0.1:55440'
  async function request(path, method = 'GET', body, token) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, data: await response.json() }
  }
  try {
    let ready = false
    for (let i = 0; i < 80; i++) {
      if (child.exitCode !== null) throw new Error('Test API exited before startup')
      try { if ((await request('/api/plans')).status === 200) { ready = true; break } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.ok(ready, 'Test API did not start')
    for (const path of ['/api/confidential/candidates', '/api/confidential/export', '/api/confidential/stats', '/api/assessments']) assert.equal((await request(path)).status, 401)
    const signupBody = (email, phone) => ({
      name: 'Recruiter',
      email,
      password: 'example-password',
      role: 'employer',
      companyName: 'Acme Hiring',
      phone,
    })
    const first = await request('/api/signup', 'POST', signupBody('a@example.test', '+15550000001'))
    assert.equal(first.status, 201)
    const dupEmail = await request('/api/signup', 'POST', signupBody('a@example.test', '+15550000099'))
    assert.equal(dupEmail.status, 409)
    const second = await request('/api/signup', 'POST', signupBody('b@example.test', '+15550000002'))
    assert.equal(second.status, 201)
    assert.equal((await request('/api/login', 'POST', { email: 'a@example.test', password: 'example-password' })).status, 200)
    const added = await request('/api/confidential/candidates', 'POST', { name: 'Private Candidate' }, first.data.token)
    assert.equal(added.status, 201)
    const candidateId = added.data.candidate.id
    assert.equal((await request('/api/confidential/candidates', 'GET', undefined, first.data.token)).data.total, 1)
    assert.equal((await request('/api/confidential/candidates', 'GET', undefined, second.data.token)).data.total, 0)
    assert.equal((await request(`/api/confidential/candidates/${candidateId}`, 'GET', undefined, second.data.token)).status, 404)
    await request(`/api/confidential/candidates/${candidateId}`, 'DELETE', undefined, second.data.token)
    assert.equal((await request(`/api/confidential/candidates/${candidateId}`, 'GET', undefined, first.data.token)).status, 200)
    assert.equal((await request('/api/signup', 'POST', null)).status, 400)
    assert.equal((await request('/api/assessments/jobs', 'POST', { organization_id: 'other' }, first.data.token)).status, 403)
    await request('/api/logout', 'POST', {}, first.data.token)
    assert.equal((await request('/api/assessments', 'GET', undefined, first.data.token)).status, 401)
  } finally {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit') }
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
  }
})
