import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import {
  mergeReviewEvents,
  canReviewRecording,
  employerCanReviewRecording,
  vendorMayViewInterviewSession,
} from '../interviewReview.mjs'
import { resolveInterviewRecordingDownload } from '../storage/interviewRecordingStorage.mjs'

const source = await readFile(new URL('../../../frontend/src/lib/reviewEventTracker.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { ReviewEventTracker } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const status = issue => ({ issue, label: issue })

test('brief glances produce no events; sustained turns have real start and duration', () => {
  const tracker = new ReviewEventTracker()
  tracker.sample(status('looking_away'), 10)
  tracker.sample(status('ok'), 12)
  assert.equal(tracker.events.length, 0)
  tracker.sample(status('looking_away'), 20)
  tracker.sample(status('looking_away'), 24)
  tracker.sample(status('ok'), 26)
  assert.equal(tracker.events.length, 1)
  assert.equal(tracker.events[0].startOffsetSec, 20)
  assert.equal(tracker.events[0].durationSec, 6)
  assert.equal(tracker.events[0].reviewOnly, true)
})

test('uncertainty breaks a pending face event and is explicitly unassessable', () => {
  const tracker = new ReviewEventTracker()
  tracker.sample(status('multi_person'), 0)
  tracker.sample(status('unable_to_assess'), 1)
  tracker.sample(status('unable_to_assess'), 3)
  tracker.finish(5)
  assert.deepEqual(tracker.events.map(e => e.eventType), ['UNABLE_TO_ASSESS'])
  assert.equal(tracker.events[0].durationSec, 4)
})

test('all sustained face events are retained, without duplicating each frame', () => {
  const tracker = new ReviewEventTracker()
  for (let i = 0; i <= 8; i++) tracker.sample(status('no_face'), i)
  tracker.sample(status('ok'), 9)
  tracker.sample(status('multi_person'), 10)
  tracker.sample(status('multi_person'), 14)
  assert.deepEqual(tracker.events.map(e => e.eventType), ['NO_FACE_SEEN', 'MULTIPLE_FACES_DETECTED'])
  assert.equal(tracker.events[0].durationSec, 9)
})

test('retries are idempotent and preserve candidate explanations', () => {
  const e = { id: 'one', eventType: 'NO_FACE_SEEN', timestamp: new Date().toISOString(), startOffsetSec: 4, durationSec: 3 }
  const saved = mergeReviewEvents([], [e])
  saved[0].candidateExplanation = 'Camera disconnected.'
  const retried = mergeReviewEvents(saved, [{ ...e, durationSec: 5 }])
  assert.equal(retried.length, 1)
  assert.equal(retried[0].durationSec, 5)
  assert.equal(retried[0].candidateExplanation, 'Camera disconnected.')
  assert.throws(() => mergeReviewEvents(saved, [{ ...e, startOffsetSec: -1 }]))
  assert.throws(() => mergeReviewEvents(saved, [{ ...e, eventType: 'CHEATING' }]))
})

test('recording access denies candidate ownership and other tenants before signing', async () => {
  const activeBucket = (process.env.S3_BUCKET || 'unit-test-bucket').trim()
  process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1'
  process.env.S3_BUCKET = activeBucket
  const row = {
    tenant_id: 'vendor-a',
    candidate_email: 'candidate@test.com',
    status: 'uploaded',
    bucket: activeBucket,
    s3_object_key: 'tenants/vendor-a/interviews/s1/recordings/recording_abcd.webm',
    original_filename: 'interview.webm',
    content_type: 'video/webm',
  }
  const pool = { query: async () => ({ rows: [row] }) }
  let signed = false
  const s3 = { headObject: async () => ({}), presignDownload: async () => { signed = true; return { url: 'private' } } }
  assert.equal(canReviewRecording('vendor-a', row), true)
  assert.equal(canReviewRecording('vendor-b', row), false)
  for (const tenantId of [undefined, 'vendor-b']) {
    await assert.rejects(resolveInterviewRecordingDownload({ pool, s3, requesterEmail: 'candidate@test.com', recordingId: 'one', tenantId }), { status: 404 })
  }
  assert.equal(signed, false)
  await resolveInterviewRecordingDownload({ pool, s3, recordingId: 'one', tenantId: 'vendor-a' })
  assert.equal(signed, true)
})

test('vendorMayViewInterviewSession requires matching candidate email and org or platform', () => {
  const platformSession = { email: 'seeker@test.com', organizationId: 'platform' }
  const orgSession = { email: 'seeker@test.com', organizationId: 'org-vendor-1' }
  assert.equal(vendorMayViewInterviewSession(platformSession, 'org-vendor-1', 'seeker@test.com'), true)
  assert.equal(vendorMayViewInterviewSession(orgSession, 'org-vendor-1', 'seeker@test.com'), true)
  assert.equal(vendorMayViewInterviewSession(orgSession, 'org-other', 'seeker@test.com'), false)
  assert.equal(vendorMayViewInterviewSession(platformSession, 'org-vendor-1', 'wrong@test.com'), false)
})

test('employerCanReviewRecording allows platform practice interviews for roster job seekers', () => {
  const db = {
    users: [{ id: 'u1', email: 'seeker@test.com', role: 'jobseeker' }],
    profiles: {},
    employerApplications: [],
    interviewSessions: {},
    organizationMembers: [],
  }
  const row = { tenant_id: 'platform', candidate_email: 'seeker@test.com', status: 'uploaded' }
  assert.equal(employerCanReviewRecording(db, 'org-vendor-1', 'seeker@test.com', row), true)
  assert.equal(employerCanReviewRecording(db, 'org-vendor-1', 'other@test.com', row), false)
  assert.equal(
    employerCanReviewRecording(db, 'org-vendor-1', 'seeker@test.com', { ...row, tenant_id: 'org-vendor-1' }),
    true,
  )
})
