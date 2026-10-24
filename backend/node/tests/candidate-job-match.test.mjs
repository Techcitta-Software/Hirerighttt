import test from 'node:test'
import assert from 'node:assert/strict'
import {
  filterOpenJobsForCandidate,
  resolveCandidateRoleHints,
  scoreJobRoleAlignment,
  applyCandidateJobScope,
} from '../vendor/jobRoleMatch.mjs'

test('resolveCandidateRoleHints collects currentRole and preferredRoles', () => {
  const hints = resolveCandidateRoleHints({
    currentRole: 'Machine Learning Engineer',
    preferredRoles: ['Data Scientist'],
    skills: ['Python', 'PyTorch'],
  })
  assert.ok(hints.includes('Machine Learning Engineer'))
  assert.ok(hints.includes('Data Scientist'))
})

test('ML engineer profile matches ML roleTrack jobs', () => {
  const jobs = [
    { id: '1', title: 'Senior ML Engineer', roleTrack: 'Machine Learning Engineer', company: 'A' },
    { id: '2', title: 'Frontend Developer', roleTrack: 'Frontend Developer', company: 'B' },
    { id: '3', title: 'Platform Lead', roleTrack: 'DevOps Engineer', company: 'C' },
  ]
  const { jobs: matched, personalized } = filterOpenJobsForCandidate(jobs, {
    currentRole: 'ML Engineer',
  })
  assert.equal(personalized, true)
  assert.equal(matched.length, 1)
  assert.equal(matched[0].id, '1')
})

test('scope=all returns every open job', () => {
  const db = {
    users: [{ email: 'c@example.com', role: 'jobseeker' }],
    profiles: { 'c@example.com': { currentRole: 'Machine Learning Engineer' } },
    jobs: [],
  }
  const jobs = [
    { title: 'A', roleTrack: 'Machine Learning Engineer' },
    { title: 'B', roleTrack: 'Frontend Developer' },
  ]
  const { jobs: out, meta } = applyCandidateJobScope(db, 'c@example.com', jobs, 'all')
  assert.equal(out.length, 2)
  assert.equal(meta.scope, 'all')
})

test('scope=matched filters by profile role from db snapshot', () => {
  const db = {
    users: [{ email: 'c@example.com', role: 'jobseeker' }],
    profiles: {
      'c@example.com': {
        currentRole: 'Machine Learning Engineer',
        preferredRoles: [],
      },
    },
    jobs: [],
  }
  const jobs = [
    { id: 'ml', title: 'Applied ML', roleTrack: 'Machine Learning Engineer' },
    { id: 'fe', title: 'React UI', roleTrack: 'Frontend Developer' },
  ]
  const { jobs: out, meta } = applyCandidateJobScope(db, 'c@example.com', jobs, 'matched')
  assert.equal(meta.scope, 'matched')
  assert.equal(meta.personalized, true)
  assert.equal(out.length, 1)
  assert.equal(out[0].id, 'ml')
  assert.ok(meta.totalOpen === 2)
  assert.ok(meta.matchedCount === 1)
})

test('scoreJobRoleAlignment uses role family for abbreviated titles', () => {
  const score = scoreJobRoleAlignment(
    { title: 'Staff AI Platform', roleTrack: 'AI Engineer' },
    ['Machine Learning Engineer'],
  )
  assert.ok(score >= 90)
})
