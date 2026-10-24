import {
  buildInterviewReportObjectKey,
  buildInterviewTranscriptObjectKey,
  resolveTenantId,
} from './s3KeyLayout.mjs'
import {
  buildS3UserMetadata,
  resolveCandidateStorageId,
  S3_OBJECT_PURPOSES,
} from './s3Namespace.mjs'
import {
  createS3ObjectStorage,
  defaultS3ObjectStorage,
  s3Env,
  s3StorageConfigured,
} from './s3ObjectStorage.mjs'
import {
  canAccessInterviewArtifact,
  getInterviewArtifact,
  getLatestInterviewArtifactForCandidate,
  upsertInterviewArtifact,
} from './interviewArtifactsRepo.mjs'
import { activeS3BucketName, rejectUnlessActiveS3Bucket } from './s3ActiveBucketGate.mjs'

const MAX_REPORT_BYTES = Number(process.env.S3_MAX_REPORT_BYTES || 12_000_000)

/**
 * @param {import('pg').Pool} pool
 * @param {{
 *   db: { interviewSessions?: Record<string, unknown> },
 *   requesterEmail: string,
 *   account?: { id?: string, primaryOrganizationId?: string } | null,
 *   sessionId: string,
 *   questions: unknown[],
 *   answers: string[],
 *   result: Record<string, unknown>,
 *   s3?: ReturnType<typeof createS3ObjectStorage>,
 * }} opts
 */
export async function persistInterviewTranscriptToS3(opts) {
  if (!s3StorageConfigured()) return null
  const email = String(opts.requesterEmail || '').toLowerCase()
  const session = /** @type {any} */ (opts.db.interviewSessions?.[opts.sessionId])
  if (!session || String(session.email || '').toLowerCase() !== email) {
    const err = new Error('Interview session not found.')
    err.status = 404
    throw err
  }
  const tenantId = resolveTenantId({
    user: opts.account,
    sessionOrganizationId: session.organizationId,
  })
  const candidateId = resolveCandidateStorageId({
    account: opts.account,
    session,
    email,
  })
  const objectKey = buildInterviewTranscriptObjectKey({
    tenantId,
    interviewId: opts.sessionId,
    candidateId,
  })
  const payload = {
    sessionId: opts.sessionId,
    tenantId,
    candidateEmail: email,
    completedAt: session.completedAt || new Date().toISOString(),
    questions: opts.questions,
    answers: opts.answers,
    resultSummary: {
      overall: opts.result.overall,
      role: opts.result.role,
      level: opts.result.level,
    },
  }
  const buffer = Buffer.from(JSON.stringify(payload, null, 2), 'utf8')
  const s3 = opts.s3 || defaultS3ObjectStorage
  const { bucket } = await s3.uploadObject({
    key: objectKey,
    buffer,
    contentType: 'application/json',
    metadata: buildS3UserMetadata({
      purpose: S3_OBJECT_PURPOSES.interview_transcript,
      tenantId,
      candidateId,
      interviewId: opts.sessionId,
    }),
  })
  try {
    await upsertInterviewArtifact(opts.pool, {
      tenantId,
      interviewId: opts.sessionId,
      candidateEmail: email,
      artifactType: 'transcript',
      s3ObjectKey: objectKey,
      bucket,
      contentType: 'application/json',
      byteSize: buffer.length,
    })
  } catch (dbErr) {
    console.warn('[interview-artifact] transcript metadata insert failed — run npm run db:init', dbErr)
  }
  return { objectKey, bucket }
}

/**
 * @param {{
 *   pool: import('pg').Pool,
 *   db: { interviewSessions?: Record<string, unknown> },
 *   requesterEmail: string,
 *   account?: { id?: string, primaryOrganizationId?: string } | null,
 *   sessionId: string,
 *   fileBase64: string,
 *   s3?: ReturnType<typeof createS3ObjectStorage>,
 * }} opts
 */
function assertReportPdfBuffer(buffer) {
  if (!buffer || buffer.length < 256) {
    const err = new Error('Report PDF is too small or empty.')
    err.status = 400
    throw err
  }
  if (buffer.length > MAX_REPORT_BYTES) {
    const err = new Error(`Report PDF exceeds ${MAX_REPORT_BYTES} bytes.`)
    err.status = 413
    throw err
  }
  if (buffer[0] !== 0x25 || buffer[1] !== 0x50 || buffer[2] !== 0x44 || buffer[3] !== 0x46) {
    const err = new Error('Report must be a PDF file.')
    err.status = 400
    throw err
  }
}

/**
 * @param {{
 *   pool: import('pg').Pool,
 *   db: { interviewSessions?: Record<string, unknown> },
 *   requesterEmail: string,
 *   account?: { id?: string, primaryOrganizationId?: string } | null,
 *   sessionId: string,
 *   buffer: Buffer,
 *   s3?: ReturnType<typeof createS3ObjectStorage>,
 * }} opts
 */
export async function persistInterviewReportPdfBuffer(opts) {
  if (!s3StorageConfigured()) {
    const err = new Error('Report storage is not configured (S3).')
    err.status = 503
    err.skipped = true
    throw err
  }
  const email = String(opts.requesterEmail || '').toLowerCase()
  const session = /** @type {any} */ (opts.db.interviewSessions?.[opts.sessionId])
  if (!session || String(session.email || '').toLowerCase() !== email) {
    const err = new Error('Interview session not found.')
    err.status = 404
    throw err
  }
  const buffer = opts.buffer
  assertReportPdfBuffer(buffer)
  const tenantId = resolveTenantId({
    user: opts.account,
    sessionOrganizationId: session.organizationId,
  })
  const candidateId = resolveCandidateStorageId({
    account: opts.account,
    session,
    email,
  })
  const objectKey = buildInterviewReportObjectKey({
    tenantId,
    interviewId: opts.sessionId,
    candidateId,
  })
  const s3 = opts.s3 || defaultS3ObjectStorage
  const { bucket } = await s3.uploadObject({
    key: objectKey,
    buffer,
    contentType: 'application/pdf',
    metadata: buildS3UserMetadata({
      purpose: S3_OBJECT_PURPOSES.interview_report,
      tenantId,
      candidateId,
      interviewId: opts.sessionId,
    }),
  })
  try {
    await upsertInterviewArtifact(opts.pool, {
      tenantId,
      interviewId: opts.sessionId,
      candidateEmail: email,
      artifactType: 'report',
      s3ObjectKey: objectKey,
      bucket,
      contentType: 'application/pdf',
      byteSize: buffer.length,
    })
  } catch (dbErr) {
    console.warn('[interview-artifact] report metadata insert failed — run npm run db:init', dbErr)
  }
  return { objectKey, bucket }
}

export async function persistInterviewReportPdfToS3(opts) {
  let buffer
  try {
    const raw = String(opts.fileBase64 || '').includes(',')
      ? String(opts.fileBase64).split(',')[1]
      : String(opts.fileBase64 || '')
    buffer = Buffer.from(raw, 'base64')
  } catch {
    const err = new Error('Invalid file_base64 for report PDF.')
    err.status = 400
    throw err
  }
  return persistInterviewReportPdfBuffer({
    pool: opts.pool,
    db: opts.db,
    requesterEmail: opts.requesterEmail,
    account: opts.account,
    sessionId: opts.sessionId,
    buffer,
    s3: opts.s3,
  })
}

/**
 * @param {{
 *   pool: import('pg').Pool,
 *   requesterEmail: string,
 *   sessionId: string,
 *   artifactType: 'transcript' | 'report',
 *   s3?: ReturnType<typeof createS3ObjectStorage>,
 * }} opts
 */
export async function resolveInterviewArtifactDownload(opts) {
  const row = await getInterviewArtifact(
    opts.pool,
    opts.sessionId,
    opts.artifactType,
    activeS3BucketName() || null,
  )
  if (!canAccessInterviewArtifact(opts.requesterEmail, row)) {
    const err = new Error('Artifact not found.')
    err.status = 404
    throw err
  }
  return presignInterviewArtifactRow(row, opts.artifactType, opts.s3, opts.inline)
}

/**
 * Latest PDF report for a candidate (vendor review — no candidate session required).
 * @param {{
 *   pool: import('pg').Pool,
 *   candidateEmail: string,
 *   inline?: boolean,
 *   s3?: ReturnType<typeof createS3ObjectStorage>,
 * }} opts
 */
export async function resolveCandidateInterviewReportDownload(opts) {
  const row = await getLatestInterviewArtifactForCandidate(
    opts.pool,
    opts.candidateEmail,
    'report',
    activeS3BucketName() || null,
  )
  if (!row) {
    const err = new Error('Interview report not found in storage.')
    err.status = 404
    throw err
  }
  return presignInterviewArtifactRow(row, 'report', opts.s3, opts.inline !== false)
}

/**
 * @param {{ s3_object_key: string, candidate_email?: string }} row
 */
async function presignInterviewArtifactRow(row, artifactType, s3Inject, inline = false) {
  rejectUnlessActiveS3Bucket(row, 'Interview artifact is not available in current storage.')
  const s3 = s3Inject || defaultS3ObjectStorage
  const head = await s3.headObject({ key: row.s3_object_key })
  if (!head) {
    const err = new Error('Artifact file is missing from storage.')
    err.status = 404
    throw err
  }
  const name =
    artifactType === 'report' ? 'interview_report.pdf' : 'transcript.json'
  const mode = inline ? 'inline' : 'attachment'
  const signed = await s3.presignDownload({
    key: row.s3_object_key,
    responseContentDisposition: `${mode}; filename="${name}"`,
  })
  return {
    ...signed,
    contentType: artifactType === 'report' ? 'application/pdf' : 'application/json',
    filename: name,
    sessionId: row.interview_id,
  }
}

export function s3TenantsPrefix() {
  return 'tenants/'
}
