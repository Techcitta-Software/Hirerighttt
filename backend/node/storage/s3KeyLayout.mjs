import { randomUUID } from 'node:crypto'

/** B2C candidates without an employer org namespace (override via S3_DEFAULT_TENANT_ID). */
export const PLATFORM_TENANT_ID = (process.env.S3_DEFAULT_TENANT_ID || 'platform').trim() || 'platform'

/** Console-friendly layout: users/{userId}/{resume|video|report|transcript}/… */
export const USERS_PREFIX = 'users'

/**
 * @param {string} segment
 */
export function sanitizePathSegment(segment) {
  return String(segment || 'unknown')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 128) || 'unknown'
}

/**
 * @param {string} filename
 */
export function extensionFromFilename(filename) {
  const base = String(filename || 'file').replace(/[^a-zA-Z0-9._-]/g, '_')
  const extMatch = base.match(/(\.[a-z0-9]{1,8})$/i)
  return extMatch ? extMatch[1].toLowerCase() : ''
}

/**
 * @param {{
 *   user?: { id?: string, primaryOrganizationId?: string } | null,
 *   sessionOrganizationId?: string | null,
 * }} ctx
 */
export function resolveTenantId(ctx = {}) {
  const fromSession = ctx.sessionOrganizationId ? String(ctx.sessionOrganizationId).trim() : ''
  if (fromSession) return sanitizePathSegment(fromSession)
  const fromUser = ctx.user?.primaryOrganizationId
    ? String(ctx.user.primaryOrganizationId).trim()
    : ''
  if (fromUser) return sanitizePathSegment(fromUser)
  return sanitizePathSegment(PLATFORM_TENANT_ID)
}

/**
 * @param {string} key
 */
export function isLegacyResumeObjectKey(key) {
  return String(key || '').startsWith('resumes/')
}

/**
 * @param {string} userId
 */
function userFolder(userId) {
  return `${USERS_PREFIX}/${sanitizePathSegment(userId || 'unknown')}`
}

/**
 * @param {{
 *   tenantId?: string,
 *   candidateId: string,
 *   originalFilename: string,
 *   versionNumber?: number,
 * }} opts
 */
export function buildCandidateResumeObjectKey(opts) {
  const uid = sanitizePathSegment(opts.candidateId)
  const ext = extensionFromFilename(opts.originalFilename) || '.pdf'
  const ver =
    Number.isFinite(opts.versionNumber) && opts.versionNumber > 1
      ? `_v${Math.floor(opts.versionNumber)}`
      : ''
  return `${userFolder(uid)}/resume/resume${ver}${ext}`
}

/**
 * @param {{
 *   tenantId?: string,
 *   candidateId: string,
 *   documentId: string,
 *   originalFilename: string,
 * }} opts
 */
export function buildCandidateCertificateObjectKey(opts) {
  const uid = sanitizePathSegment(opts.candidateId)
  const docId = sanitizePathSegment(opts.documentId)
  const ext = extensionFromFilename(opts.originalFilename) || '.pdf'
  return `${userFolder(uid)}/resume/certificate_${docId}${ext}`
}

/** @deprecated v2 nested path — only for parsing legacy keys. */
export function buildInterviewSessionPrefix(opts) {
  const tid = sanitizePathSegment(opts.tenantId)
  const iid = sanitizePathSegment(opts.interviewId)
  const cid = opts.candidateId ? sanitizePathSegment(opts.candidateId) : ''
  if (cid) {
    return `tenants/${tid}/candidates/${cid}/interviews/${iid}`
  }
  return `tenants/${tid}/interviews/${iid}`
}

/**
 * @param {{
 *   tenantId?: string,
 *   interviewId: string,
 *   candidateId: string,
 *   segmentId?: string,
 *   originalFilename?: string,
 *   contentType?: string,
 * }} opts
 */
export function buildInterviewRecordingObjectKey(opts) {
  const uid = sanitizePathSegment(opts.candidateId || 'unknown')
  const iid = sanitizePathSegment(opts.interviewId)
  let ext = extensionFromFilename(opts.originalFilename || '')
  if (!ext) {
    const ct = String(opts.contentType || '').toLowerCase()
    if (ct.includes('mp4')) ext = '.mp4'
    else ext = '.webm'
  }
  return `${userFolder(uid)}/video/${iid}${ext}`
}

/**
 * @param {{
 *   tenantId?: string,
 *   interviewId: string,
 *   candidateId: string,
 *   artifactId?: string,
 * }} opts
 */
export function buildInterviewTranscriptObjectKey(opts) {
  const uid = sanitizePathSegment(opts.candidateId || 'unknown')
  const iid = sanitizePathSegment(opts.interviewId)
  const suffix = opts.artifactId ? `_${sanitizePathSegment(opts.artifactId)}` : ''
  return `${userFolder(uid)}/transcript/${iid}${suffix}.json`
}

/**
 * @param {{
 *   tenantId?: string,
 *   interviewId: string,
 *   candidateId: string,
 *   reportId?: string,
 * }} opts
 */
export function buildInterviewReportObjectKey(opts) {
  const uid = sanitizePathSegment(opts.candidateId || 'unknown')
  const iid = sanitizePathSegment(opts.interviewId)
  const suffix = opts.reportId ? `_${sanitizePathSegment(opts.reportId)}` : ''
  return `${userFolder(uid)}/report/${iid}${suffix}.pdf`
}

/**
 * Proctoring evidence JPEG — stored under the user's video folder (not a fifth top-level folder).
 * @param {{ tenantId?: string, candidateId?: string, sessionId: string, flagId: string }} opts
 */
export function buildFlagSnapshotS3Key(opts) {
  const uid = sanitizePathSegment(opts.candidateId || 'unknown')
  const sid = sanitizePathSegment(opts.sessionId)
  const fid = sanitizePathSegment(opts.flagId)
  return `${userFolder(uid)}/video/proctor_${sid}_${fid}.jpg`
}

/** Stable id for smoke tests when no auth user exists. */
export function randomStorageSuffix() {
  return randomUUID().slice(0, 8)
}
