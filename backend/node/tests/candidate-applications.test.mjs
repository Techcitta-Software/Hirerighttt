import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyDb } from '../db/store.mjs'
import {
  buildCandidateJobApplicationRecord,
  recordCandidateJobApplication,
  mapEmployerStatusToCandidateStatus,
} from '../vendor/candidateApplications.mjs'

test('mapEmployerStatusToCandidateStatus maps pipeline states', () => {
  assert.equal(mapEmployerStatusToCandidateStatus('applied'), 'Applied')
  assert.equal(mapEmployerStatusToCandidateStatus('interviewed'), 'In Review')
  assert.equal(mapEmployerStatusToCandidateStatus('shortlisted'), 'Interview')
})

test('recordCandidateJobApplication stores job details for candidate', () => {
  const db = emptyDb()
  const job = {
    id: 'job-1',
    organizationId: 'org-1',
    title: 'Platform Engineer',
    company: 'Acme',
    location: 'Remote',
    roleTrack: 'Backend',
    experienceLevel: '3-5 years',
    shareableCode: 'abc123',
    companySlug: 'acme',
    jobDescription: 'Build APIs',
    createdAt: new Date().toISOString(),
  }
  const employerApp = {
    id: 'app-1',
    organizationId: 'org-1',
    jobId: 'job-1',
    candidateEmail: 'cand@example.test',
    status: 'applied',
    appliedAt: '2026-01-15T10:00:00.000Z',
    data: {
      candidateName: 'Cand',
      atsScore: 82,
      interviewScore: 91,
      interviewResult: { overall: 91, role: 'Backend Dev' },
    },
  }
  const record = recordCandidateJobApplication(db, 'cand@example.test', job, employerApp, {
    match: 88,
  })
  assert.equal(record.jobId, 'job-1')
  assert.equal(record.title, 'Platform Engineer')
  assert.equal(record.company, 'Acme')
  assert.equal(record.shareableCode, 'abc123')
  assert.equal(record.match, 88)
  assert.equal(record.interviewScore, 91)
  assert.equal(db.applications['cand@example.test'].length, 1)

  const built = buildCandidateJobApplicationRecord(job, employerApp, {})
  assert.equal(built.match, 82)
})
