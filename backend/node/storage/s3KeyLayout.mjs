import { randomUUID } from 'node:crypto'

/** B2C candidates without an employer org namespace (override via S3_DEFAULT_TENANT_ID). */
export const PLATFORM_TENANT_ID = (process.env.S3_DEFAULT_TENANT_ID || 'platform').trim() || 'platform'

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
 * Layout v3: type-first folders under each tenant (easy to browse in S3 console).
 * @param {{
 *   tenantId: string,
 *   candidateId: string,
 *   originalFilename: string,
 *   versionNumber?: number,
 * }} opts
 */
export function buildCandidateResumeObjectKey(opts) {
  const tid = sanitizePathSegment(opts.tenantId)
  const cid = sanitizePathSegment(opts.candidateId)
  const ext = extensionFromFilename(opts.originalFilename) || '.bin'
  const ver =
    Number.isFinite(opts.versionNumber) && opts.versionNumber > 0
      ? Math.floor(opts.versionNumber)
      : 1
  const unique = randomUUID()
  return `tenants/${tid}/resumes/${cid}/resume_v${ver}_${unique}${ext}`
}

/**
 * @param {{
 *   tenantId: string,
 *   candidateId: string,
 *   documentId: string,
 *   originalFilename: string,
 * }} opts
 */
export function buildCandidateCertificateObjectKey(opts) {
  const tid = sanitizePathSegment(opts.tenantId)
  const cid = sanitizePathSegment(opts.candidateId)
  const docId = sanitizePathSegment(opts.documentId)
  const ext = extensionFromFilename(opts.originalFilename) || '.pdf'
  return `tenants/${tid}/certificates/${cid}/${docId}${ext}`
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
 * All interview videos for a tenant live under tenants/{tenant}/videos/{sessionId}/.
 * @param {{
 *   tenantId: string,
 *   interviewId: string,
 *   candidateId?: string,
 *   segmentId?: string,
 *   originalFilename?: string,
 *   contentType?: string,
 * }} opts
 */
export function buildInterviewRecordingObjectKey(opts) {
  const tid = sanitizePathSegment(opts.tenantId)
  const iid = sanitizePathSegment(opts.interviewId)
  let ext = extensionFromFilename(opts.originalFilename || '')
  if (!ext) {
    const ct = String(opts.contentType || '').toLowerCase()
    if (ct.includes('mp4')) ext = '.mp4'
    else ext = '.webm'
  }
  const unique = randomUUID().slice(0, 8)
  return `tenants/${tid}/videos/${iid}/recording_${unique}${ext}`
}

/**
 * @param {{
 *   tenantId: string,
 *   interviewId: string,
 *   candidateId?: string,
 *   artifactId?: string,
 * }} opts
 */
export function buildInterviewTranscriptObjectKey(opts) {
  const tid = sanitizePathSegment(opts.tenantId)
  const iid = sanitizePathSegment(opts.interviewId)
  const suffix = opts.artifactId ? `_${sanitizePathSegment(opts.artifactId)}` : ''
  return `tenants/${tid}/transcripts/${iid}/transcript${suffix}.json`
}

/**
 * @param {{
 *   tenantId: string,
 *   interviewId: string,
 *   candidateId?: string,
 *   reportId?: string,
 * }} opts
 */
export function buildInterviewReportObjectKey(opts) {
  const tid = sanitizePathSegment(opts.tenantId)
  const iid = sanitizePathSegment(opts.interviewId)
  const suffix = opts.reportId ? `_${sanitizePathSegment(opts.reportId)}` : ''
  return `tenants/${tid}/reports/${iid}/interview_report${suffix}.pdf`
}

/**
 * Proctoring evidence frame for a flagged interval during interview recording.
 * @param {{ tenantId?: string, sessionId: string, flagId: string }} opts
 */
export function buildFlagSnapshotS3Key(opts) {
  const tid = sanitizePathSegment(opts.tenantId || PLATFORM_TENANT_ID)
  const sid = sanitizePathSegment(opts.sessionId)
  const fid = sanitizePathSegment(opts.flagId)
  return `tenants/${tid}/videos/${sid}/flags/${fid}.jpg`
}
