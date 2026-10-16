import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getJobByShareableCode,
  parsePublicJobPath,
  slugifyCompanyName,
} from '../vendor/jobs.mjs'

test('parsePublicJobPath reads slug and code', () => {
  const a = parsePublicJobPath('/api/jobs/public/acme-corp/a1b2c3')
  assert.equal(a.code, 'a1b2c3')
  assert.equal(a.companySlug, 'acme-corp')
  assert.equal(a.isApply, false)

  const b = parsePublicJobPath('/api/jobs/public/acme-corp/a1b2c3/apply')
  assert.equal(b.code, 'a1b2c3')
  assert.equal(b.companySlug, 'acme-corp')
  assert.equal(b.isApply, true)

  const c = parsePublicJobPath('/api/jobs/public/onlycode')
  assert.equal(c.code, 'onlycode')
  assert.equal(c.companySlug, null)
})

test('getJobByShareableCode matches by code when slug differs', () => {
  const db = {
    jobs: [
      {
        id: 'j1',
        company: 'Acme Corp',
        companySlug: 'acme-corp',
        shareableCode: 'abc123',
        status: 'active',
        title: 'Engineer',
      },
    ],
  }
  const job = getJobByShareableCode(db, 'abc123', 'wrong-slug')
  assert.ok(job)
  assert.equal(job.id, 'j1')
  assert.equal(slugifyCompanyName('Acme Corp'), 'acme-corp')
})
