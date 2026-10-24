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
  assert.equal(layout.version, 3)
  assert.match(layout.paths.resume, /^tenants\//)
  assert.match(layout.paths.interviewReport, /interview_report\.pdf$/)
})

test('resolveCandidateStorageId prefers account id', () => {
  assert.equal(
    resolveCandidateStorageId({ account: { id: 'uuid-1' }, email: 'a@b.com' }),
    'uuid-1',
  )
})

test('assertWritableTenantObjectKey rejects non-tenant keys', () => {
  assert.throws(() => assertWritableTenantObjectKey('public/resume.pdf'), /tenants/)
})

test('parseTenantObjectKey reads v3 type-first report path', () => {
  const key = 'tenants/org/reports/s1/interview_report.pdf'
  const parsed = parseTenantObjectKey(key)
  assert.equal(parsed.kind, 'interview_artifact')
  assert.equal(parsed.layout, 'type_first')
  assert.equal(parsed.tenantId, 'org')
  assert.equal(parsed.interviewId, 's1')
  assert.equal(parsed.artifactFolder, 'reports')
})

test('parseTenantObjectKey still reads legacy candidate-scoped paths', () => {
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
  assert.equal(meta.layout, '3')
  assert.equal(meta.tenant, 'org-1')
})
