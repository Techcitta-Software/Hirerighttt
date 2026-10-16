import test from 'node:test'
import assert from 'node:assert/strict'
import {
  deleteVendorJob,
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

test('deleteVendorJob removes org-scoped job and linked applications from memory', () => {
  const db = {
    jobs: [
      { id: 'j1', organizationId: 'org-a', title: 'One', status: 'active' },
      { id: 'j2', organizationId: 'org-a', title: 'Two', status: 'active' },
      { id: 'j3', organizationId: 'org-b', title: 'Other org', status: 'active' },
    ],
    employerApplications: [
      { id: 'a1', jobId: 'j1', candidateEmail: 'x@test.com' },
      { id: 'a2', jobId: 'j2', candidateEmail: 'y@test.com' },
    ],
  }
  const removed = deleteVendorJob(db, 'org-a', 'j1')
  assert.equal(removed.id, 'j1')
  assert.equal(db.jobs.length, 2)
  assert.ok(db.jobs.some((j) => j.id === 'j2'))
  assert.ok(db.jobs.some((j) => j.id === 'j3'))
  assert.equal(db.employerApplications.length, 1)
  assert.equal(db.employerApplications[0].jobId, 'j2')
  assert.throws(() => deleteVendorJob(db, 'org-a', 'missing'), /Job not found/)
})
