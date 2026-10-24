import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCandidateResumeObjectKey,
  buildInterviewRecordingObjectKey,
  buildInterviewReportObjectKey,
  buildInterviewTranscriptObjectKey,
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

test('buildCandidateResumeObjectKey uses tenant namespace', () => {
  const key = buildCandidateResumeObjectKey({
    tenantId: 'org-1',
    candidateId: 'user-9',
    originalFilename: 'resume.pdf',
    versionNumber: 2,
  })
  assert.match(key, /^tenants\/org-1\/candidates\/user-9\/resumes\/resume_v2_[0-9a-f-]+\.pdf$/)
  assert.equal(isLegacyResumeObjectKey(key), false)
  assert.equal(isLegacyResumeObjectKey('resumes/a/b.pdf'), true)
})

test('buildInterviewTranscriptObjectKey uses candidate-scoped path when candidateId set', () => {
  const key = buildInterviewTranscriptObjectKey({
    tenantId: 'org-1',
    interviewId: 'sess-9',
    candidateId: 'user-1',
  })
  assert.equal(
    key,
    'tenants/org-1/candidates/user-1/interviews/sess-9/transcripts/transcript.json',
  )
})

test('buildInterviewTranscriptObjectKey falls back to flat tenant path', () => {
  const key = buildInterviewTranscriptObjectKey({
    tenantId: 'org-1',
    interviewId: 'sess-9',
  })
  assert.equal(key, 'tenants/org-1/interviews/sess-9/transcripts/transcript.json')
})

test('buildInterviewReportObjectKey uses interview_report.pdf under candidate', () => {
  const key = buildInterviewReportObjectKey({
    tenantId: 'org-1',
    interviewId: 'sess-9',
    candidateId: 'user-1',
  })
  assert.equal(
    key,
    'tenants/org-1/candidates/user-1/interviews/sess-9/reports/interview_report.pdf',
  )
})

test('buildInterviewRecordingObjectKey uses candidate-scoped recordings', () => {
  const key = buildInterviewRecordingObjectKey({
    tenantId: 'platform',
    interviewId: 'sess-1',
    candidateId: 'cand-9',
    contentType: 'video/webm',
  })
  assert.match(
    key,
    /^tenants\/platform\/candidates\/cand-9\/interviews\/sess-1\/recordings\/recording_[a-f0-9]+\.webm$/,
  )
})
