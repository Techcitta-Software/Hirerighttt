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

test('buildCandidateResumeObjectKey uses tenant resumes folder', () => {
  const key = buildCandidateResumeObjectKey({
    tenantId: 'org-1',
    candidateId: 'user-9',
    originalFilename: 'resume.pdf',
    versionNumber: 2,
  })
  assert.match(key, /^tenants\/org-1\/resumes\/user-9\/resume_v2_[0-9a-f-]+\.pdf$/)
  assert.equal(isLegacyResumeObjectKey(key), false)
  assert.equal(isLegacyResumeObjectKey('resumes/a/b.pdf'), true)
})

test('buildInterviewTranscriptObjectKey uses transcripts folder per session', () => {
  const key = buildInterviewTranscriptObjectKey({
    tenantId: 'org-1',
    interviewId: 'sess-9',
    candidateId: 'user-1',
  })
  assert.equal(key, 'tenants/org-1/transcripts/sess-9/transcript.json')
})

test('buildInterviewReportObjectKey uses reports folder per session', () => {
  const key = buildInterviewReportObjectKey({
    tenantId: 'org-1',
    interviewId: 'sess-9',
    candidateId: 'user-1',
  })
  assert.equal(key, 'tenants/org-1/reports/sess-9/interview_report.pdf')
})

test('buildInterviewRecordingObjectKey uses videos folder per session', () => {
  const key = buildInterviewRecordingObjectKey({
    tenantId: 'platform',
    interviewId: 'sess-1',
    candidateId: 'cand-9',
    contentType: 'video/webm',
  })
  assert.match(key, /^tenants\/platform\/videos\/sess-1\/recording_[a-f0-9]+\.webm$/)
})
