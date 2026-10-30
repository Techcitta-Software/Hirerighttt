import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCandidateResumeObjectKey,
  buildInterviewRecordingObjectKey,
  buildInterviewReportObjectKey,
  buildInterviewTranscriptObjectKey,
  buildFlagSnapshotS3Key,
  isLegacyResumeObjectKey,
  resolveTenantId,
  sanitizePathSegment,
} from '../storage/s3KeyLayout.mjs'

test('sanitizePathSegment removes unsafe characters', () => {
  assert.equal(sanitizePathSegment('user@mail.com'), 'user_mail.com')
})

test('resolveTenantId prefers session organization', () => {
  assert.equal(
    resolveTenantId({ user: { primaryOrganizationId: 'org-a' }, sessionOrganizationId: 'org-b' }),
    'org-b',
  )
  assert.equal(resolveTenantId({ user: { primaryOrganizationId: 'org-a' } }), 'org-a')
})

test('buildCandidateResumeObjectKey uses users/{id}/resume/', () => {
  const key = buildCandidateResumeObjectKey({
    tenantId: 'org-1',
    candidateId: 'user-9',
    originalFilename: 'resume.pdf',
    versionNumber: 2,
  })
  assert.equal(key, 'users/user-9/resume/resume_v2.pdf')
  assert.equal(isLegacyResumeObjectKey(key), false)
  assert.equal(isLegacyResumeObjectKey('resumes/a/b.pdf'), true)
})

test('buildInterviewTranscriptObjectKey uses users/{id}/transcript/', () => {
  const key = buildInterviewTranscriptObjectKey({
    tenantId: 'org-1',
    interviewId: 'sess-9',
    candidateId: 'user-1',
  })
  assert.equal(key, 'users/user-1/transcript/sess-9.json')
})

test('buildInterviewReportObjectKey uses users/{id}/report/', () => {
  const key = buildInterviewReportObjectKey({
    tenantId: 'org-1',
    interviewId: 'sess-9',
    candidateId: 'user-1',
  })
  assert.equal(key, 'users/user-1/report/sess-9.pdf')
})

test('buildInterviewRecordingObjectKey uses users/{id}/video/', () => {
  const key = buildInterviewRecordingObjectKey({
    tenantId: 'platform',
    interviewId: 'sess-1',
    candidateId: 'cand-9',
    contentType: 'video/webm',
  })
  assert.equal(key, 'users/cand-9/video/sess-1.webm')
})

test('buildFlagSnapshotS3Key lives under user video folder', () => {
  const key = buildFlagSnapshotS3Key({
    candidateId: 'u1',
    sessionId: 's1',
    flagId: 'f1',
  })
  assert.equal(key, 'users/u1/video/proctor_s1_f1.jpg')
})
