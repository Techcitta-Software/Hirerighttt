import { canReviewRecording, employerCanReviewRecording } from '../interviewReview.mjs'
import { assertVendorMayViewCandidateDocuments } from '../vendor/candidateDocuments.mjs'
import { getLatestInterviewRecordingForCandidate } from './interviewRecordingsRepo.mjs'
import {
  buildInterviewRecordingObjectKey,
  resolveTenantId,
} from './s3KeyLayout.mjs'
import { resolveCandidateStorageId } from './s3Namespace.mjs'
import { activeS3BucketName, rejectUnlessActiveS3Bucket } from './s3ActiveBucketGate.mjs'
import {
  createS3ObjectStorage,
  defaultS3ObjectStorage,
  s3Env,
  s3StorageConfigured,
} from './s3ObjectStorage.mjs'
import {
  canAccessInterviewRecording,
  getInterviewRecordingById,
  insertInterviewRecording,
  updateInterviewRecording,
} from './interviewRecordingsRepo.mjs'
import { extensionFromFilename } from './s3KeyLayout.mjs'

export const MAX_RECORDING_BYTES = Number(process.env.S3_MAX_RECORDING_BYTES || 104_857_600)

const ALLOWED_RECORDING_TYPES = new Set([
  'video/webm',
  'video/mp4',
  'video/x-matroska',
  'application/octet-stream',
])

/**
 * @param {string} contentType
 * @param {string} filename
 */
export function inferRecordingContentType(contentType, filename) {
  const ct = String(contentType || '').split(';')[0].trim().toLowerCase()
  if (ALLOWED_RECORDING_TYPES.has(ct)) {
    if (ct === 'application/octet-stream') {
      const ext = extensionFromFilename(filename)
      if (ext === '.mp4') return 'video/mp4'
      return 'video/webm'
    }
    return ct
  }
  const ext = extensionFromFilename(filename)
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.webm') return 'video/webm'
  const err = new Error('Recording must be WebM or MP4.')
  err.status = 400
  throw err
}

/**
 * @param {{
 *   pool: import('pg').Pool,
 *   db: import('../server/appContext.mjs').createAppContext extends () => infer R ? R : never,
 *   requesterEmail: string,
 *   account?: { id?: string, primaryOrganizationId?: string } | null,
 *   sessionId: string,
 *   filename?: string,
 *   contentType?: string,
 *   fileSize?: number,
 *   s3?: ReturnType<typeof createS3ObjectStorage>,
 * }} opts
 */
export async function authorizeInterviewRecordingUpload(opts) {
  if (!s3StorageConfigured()) {
    const err = new Error('Interview recording storage is not configured (S3).')
    err.status = 503
    err.skipped = true
    throw err
  }
  const email = String(opts.requesterEmail || '').toLowerCase()
  const sessionId = String(opts.sessionId || '').trim()
  const session = sessionId ? /** @type {any} */ (opts.db.interviewSessions?.[sessionId]) : null
  if (!session || String(session.email || '').toLowerCase() !== email) {
    const err = new Error('Interview session not found.')
    err.status = 404
    throw err
  }
  const fileSize = Number(opts.fileSize || 0)
  if (!Number.isFinite(fileSize) || fileSize < 256) {
    const err = new Error('Recording file is too small.')
    err.status = 400
    throw err
  }
  if (fileSize > MAX_RECORDING_BYTES) {
    const err = new Error(`Recording exceeds maximum size (${MAX_RECORDING_BYTES} bytes).`)
    err.status = 413
    throw err
  }
  const filename = String(opts.filename || 'interview_recording.webm')
  const contentType = inferRecordingContentType(opts.contentType, filename)
  const tenantId = resolveTenantId({
    user: opts.account,
    sessionOrganizationId: session.organizationId,
  })
  const candidateId = resolveCandidateStorageId({
    account: opts.account,
    session,
    email,
  })
  const objectKey = buildInterviewRecordingObjectKey({
    tenantId,
    interviewId: sessionId,
    candidateId,
    originalFilename: filename,
    contentType,
  })
  const { bucket } = s3Env()
  const s3 = opts.s3 || defaultS3ObjectStorage
  let recordingId
  try {
    recordingId = await insertInterviewRecording(opts.pool, {
      tenantId,
      interviewId: sessionId,
      candidateId,
      candidateEmail: email,
      s3ObjectKey: objectKey,
      bucket,
      originalFilename: filename,
      contentType,
      fileSizeBytes: fileSize,
      status: 'uploading',
    })
  } catch (dbErr) {
    console.warn('[recording-upload] metadata insert failed — run npm run db:init', dbErr)
    const err = new Error('Could not create recording metadata.')
    err.status = 503
    throw err
  }
  // Browser PUT cannot sign optional x-amz-meta-* without matching client headers — metadata lives in Neon.
  const presigned = await s3.presignUpload({
    key: objectKey,
    contentType,
    contentLength: fileSize,
  })
  return {
    recordingId,
    objectKey,
    bucket,
    uploadUrl: presigned.url,
    uploadMethod: presigned.method,
    expiresInSeconds: presigned.expiresInSeconds,
    contentType,
  }
}

/**
 * @param {{
 *   pool: import('pg').Pool,
 *   requesterEmail: string,
 *   recordingId: string,
 *   sessionId: string,
 *   durationSeconds?: number,
 *   s3?: ReturnType<typeof createS3ObjectStorage>,
 * }} opts
 */
export async function completeInterviewRecordingUpload(opts) {
  const row = await getInterviewRecordingById(opts.pool, opts.recordingId)
  if (!canAccessInterviewRecording(opts.requesterEmail, row)) {
    const err = new Error('Recording not found.')
    err.status = 404
    throw err
  }
  if (String(row.interview_id) !== String(opts.sessionId)) {
    const err = new Error('Recording does not match this interview session.')
    err.status = 403
    throw err
  }
  const s3 = opts.s3 || defaultS3ObjectStorage
  const head = await s3.headObject({ key: row.s3_object_key })
  if (!head) {
    await updateInterviewRecording(opts.pool, opts.recordingId, { status: 'failed' })
    const err = new Error('Recording file was not found in storage.')
    err.status = 400
    throw err
  }
  const size = Number(head.ContentLength || row.file_size_bytes || 0)
  await updateInterviewRecording(opts.pool, opts.recordingId, {
    status: 'uploaded',
    fileSizeBytes: size,
    durationSeconds: opts.durationSeconds ?? null,
  })
  return { recordingId: opts.recordingId, objectKey: row.s3_object_key, status: 'uploaded' }
}

/**
 * @param {{
 *   pool: import('pg').Pool,
 *   requesterEmail: string,
 *   recordingId: string,
 *   s3?: ReturnType<typeof createS3ObjectStorage>,
 * }} opts
 */
async function presignRecordingPlayback(row, s3Inject) {
  rejectUnlessActiveS3Bucket(row, 'Interview recording is not available in current storage.')
  const s3 = s3Inject || defaultS3ObjectStorage
  const head = await s3.headObject({ key: row.s3_object_key })
  if (!head) {
    const err = new Error('Recording file is missing from storage.')
    err.status = 404
    throw err
  }
  const safeName = String(row.original_filename || 'interview.webm').replace(/"/g, '')
  const contentType = String(row.content_type || 'video/webm').split(';')[0].trim()
  const signed = await s3.presignDownload({
    key: row.s3_object_key,
    responseContentDisposition: `inline; filename="${safeName}"`,
    responseContentType: contentType,
  })
  return {
    ...signed,
    contentType,
    filename: safeName,
    interviewId: row.interview_id,
    durationSeconds: row.duration_seconds,
    fileSizeBytes: row.file_size_bytes,
  }
}

export async function resolveInterviewRecordingDownload(opts) {
  const row = await getInterviewRecordingById(opts.pool, opts.recordingId)
  if (!canReviewRecording(opts.tenantId, row)) {
    const err = new Error('Recording not found.')
    err.status = 404
    throw err
  }
  if (row.status !== 'uploaded' && row.status !== 'completed') {
    const err = new Error('Recording is not ready for playback.')
    err.status = 409
    throw err
  }
  return presignRecordingPlayback(row, opts.s3)
}

/**
 * Presigned GET for HTML5 streaming (Range requests go directly to S3).
 * @param {{
 *   pool: import('pg').Pool,
 *   db: import('../db/store.mjs').DbShape,
 *   organizationId: string,
 *   candidateEmail: string,
 *   s3?: ReturnType<typeof createS3ObjectStorage>,
 * }} opts
 */
export async function resolveEmployerCandidateRecordingPlayback(opts) {
  assertVendorMayViewCandidateDocuments(opts.db, opts.organizationId, opts.candidateEmail)
  const row = await getLatestInterviewRecordingForCandidate(
    opts.pool,
    opts.candidateEmail,
    activeS3BucketName() || null,
  )
  if (!employerCanReviewRecording(opts.db, opts.organizationId, opts.candidateEmail, row)) {
    const err = new Error('Interview recording not found.')
    err.status = 404
    throw err
  }
  return presignRecordingPlayback(row, opts.s3)
}
