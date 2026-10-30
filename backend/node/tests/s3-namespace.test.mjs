import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertWritableTenantObjectKey,
  buildS3UserMetadata,
  describeS3Layout,
  parseTenantObjectKey,
  resolveCandidateStorageId,
} from '../storage/s3Namespace.mjs'

test('describeS3Layout documents production paths', () => {
  const layout = describeS3Layout()
  assert.equal(layout.version, 4)
  assert.match(layout.paths.resume, /^users\//)
  assert.match(layout.paths.interviewReport, /\.pdf$/)
})

test('resolveCandidateStorageId prefers account id', () => {
  assert.equal(
    resolveCandidateStorageId({ account: { id: 'uuid-1' }, email: 'a@b.com' }),
    'uuid-1',
  )
})

test('assertWritableTenantObjectKey rejects non-user keys', () => {
  assert.throws(() => assertWritableTenantObjectKey('public/resume.pdf'), /users/)
})

test('parseTenantObjectKey reads v4 user report path', () => {
  const key = 'users/u1/report/s1.pdf'
  const parsed = parseTenantObjectKey(key)
  assert.equal(parsed.kind, 'interview_artifact')
  assert.equal(parsed.layout, 'user_scoped')
  assert.equal(parsed.userId, 'u1')
  assert.equal(parsed.artifactFolder, 'report')
})

test('parseTenantObjectKey still reads legacy tenant paths', () => {
  const key =
    'tenants/org/candidates/u1/interviews/s1/reports/interview_report.pdf'
  const parsed = parseTenantObjectKey(key)
  assert.equal(parsed.layout, 'candidate_scoped')
  assert.equal(parsed.candidateId, 'u1')
})

test('buildS3UserMetadata includes purpose and layout version', () => {
  const meta = buildS3UserMetadata({
    purpose: 'interview_report',
    tenantId: 'org-1',
    candidateId: 'c-1',
    interviewId: 'sess-1',
  })
  assert.equal(meta.purpose, 'interview_report')
  assert.equal(meta.layout, '4')
  assert.equal(meta.tenant, 'org-1')
})
