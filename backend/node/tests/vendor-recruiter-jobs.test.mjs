import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  listOrgJobs,
  getOrgJobForRecruiter,
  getOrgApplicationForRecruiter,
  jobVisibleToRecruiter,
} from '../vendor/jobs.mjs'
import {
  listEmployerApplicationAlerts,
  queueEmployerApplicationAlert,
} from '../vendor/employerApplicationAlerts.mjs'

const orgA = 'org-a'
const recruiter1 = 'user-r1'
const recruiter2 = 'user-r2'

function sampleDb() {
  return {
    jobs: [
      {
        id: 'job-r1',
        organizationId: orgA,
        createdByUserId: recruiter1,
        title: 'R1 role',
        status: 'active',
        createdAt: '2026-01-02T00:00:00.000Z',
      },
      {
        id: 'job-r2',
        organizationId: orgA,
        createdByUserId: recruiter2,
        title: 'R2 role',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'job-other-org',
        organizationId: 'org-b',
        createdByUserId: recruiter1,
        title: 'Other org',
        status: 'active',
        createdAt: '2026-01-03T00:00:00.000Z',
      },
    ],
    employerApplications: [
      {
        id: 'app-r1',
        organizationId: orgA,
        jobId: 'job-r1',
        candidateEmail: 'c1@example.com',
        appliedAt: '2026-01-05T00:00:00.000Z',
      },
      {
        id: 'app-r2',
        organizationId: orgA,
        jobId: 'job-r2',
        candidateEmail: 'c2@example.com',
        appliedAt: '2026-01-05T00:00:00.000Z',
      },
    ],
    employerApplicationAlerts: {},
    users: [],
  }
}

test('listOrgJobs returns only jobs created by the recruiter in their org', () => {
  const db = sampleDb()
  const scope = { createdByUserId: recruiter1 }
  const jobs = listOrgJobs(db, orgA, scope)
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].id, 'job-r1')
})

test('getOrgJobForRecruiter hides colleague jobs in same org', () => {
  const db = sampleDb()
  const scope = { createdByUserId: recruiter1 }
  assert.ok(getOrgJobForRecruiter(db, orgA, 'job-r1', scope))
  assert.equal(getOrgJobForRecruiter(db, orgA, 'job-r2', scope), null)
  assert.equal(getOrgJobForRecruiter(db, orgA, 'job-other-org', scope), null)
})

test('getOrgApplicationForRecruiter respects job ownership', () => {
  const db = sampleDb()
  const scope = { createdByUserId: recruiter1 }
  assert.ok(getOrgApplicationForRecruiter(db, orgA, 'app-r1', scope))
  assert.equal(getOrgApplicationForRecruiter(db, orgA, 'app-r2', scope), null)
})

test('legacy jobs without createdByUserId match creator email', () => {
  const job = { createdByEmail: 'alice@vendor.com' }
  assert.ok(
    jobVisibleToRecruiter(job, { createdByUserId: 'x', createdByEmail: 'alice@vendor.com' }),
  )
  assert.ok(!jobVisibleToRecruiter(job, { createdByUserId: 'x', createdByEmail: 'bob@vendor.com' }))
})

test('application alerts are scoped to recruiter jobs', () => {
  const db = sampleDb()
  queueEmployerApplicationAlert(db, db.jobs[0], db.employerApplications[0], true)
  queueEmployerApplicationAlert(db, db.jobs[1], db.employerApplications[1], true)
  const r1Alerts = listEmployerApplicationAlerts(db, orgA, {
    unreadOnly: false,
    createdByUserId: recruiter1,
  })
  assert.equal(r1Alerts.length, 1)
  assert.equal(r1Alerts[0].jobId, 'job-r1')
})
