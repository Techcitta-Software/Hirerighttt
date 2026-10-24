import { isLegacyResumeObjectKey, sanitizePathSegment } from './s3KeyLayout.mjs'

/** Bump when key layout or required metadata changes (see .env.example). */
export const S3_LAYOUT_VERSION = 2

export const TENANTS_PREFIX = 'tenants'

/** @readonly */
export const S3_OBJECT_PURPOSES = Object.freeze({
  resume: 'resume',
  certificate: 'certificate',
  interview_transcript: 'interview_transcript',
  interview_report: 'interview_report',
  interview_recording: 'interview_recording',
})

/**
 * Production layout (single bucket, private, server-side encryption on PutObject).
 *
 * tenants/{tenantId}/candidates/{candidateId}/resumes/…
 * tenants/{tenantId}/candidates/{candidateId}/certificates/…
 * tenants/{tenantId}/candidates/{candidateId}/interviews/{sessionId}/transcripts/transcript.json
 * tenants/{tenantId}/candidates/{candidateId}/interviews/{sessionId}/reports/interview_report.pdf
 * tenants/{tenantId}/candidates/{candidateId}/interviews/{sessionId}/recordings/recording_*.webm
 *
 * Legacy (read-only; no new writes): resumes/{email}/…
 * Legacy flat interviews (existing rows in DB): tenants/{tenantId}/interviews/{sessionId}/…
 */
export function describeS3Layout() {
  return {
    version: S3_LAYOUT_VERSION,
    singleBucketEnv: 'S3_BUCKET',
    rootPrefix: `${TENANTS_PREFIX}/`,
    tenantResolution: 'session organizationId → user primaryOrganizationId → S3_DEFAULT_TENANT_ID (platform)',
    paths: {
      resume: `${TENANTS_PREFIX}/{tenantId}/candidates/{candidateId}/resumes/resume_v{n}_{uuid}.{ext}`,
      certificate: `${TENANTS_PREFIX}/{tenantId}/candidates/{candidateId}/certificates/{documentId}.{ext}`,
      interviewTranscript: `${TENANTS_PREFIX}/{tenantId}/candidates/{candidateId}/interviews/{sessionId}/transcripts/transcript.json`,
      interviewReport: `${TENANTS_PREFIX}/{tenantId}/candidates/{candidateId}/interviews/{sessionId}/reports/interview_report.pdf`,
      interviewRecording: `${TENANTS_PREFIX}/{tenantId}/candidates/{candidateId}/interviews/{sessionId}/recordings/recording_{uuid8}.{ext}`,
      legacyResume: 'resumes/{sanitizedEmail}/{uuid}.{ext}',
      legacyInterviewFlat: `${TENANTS_PREFIX}/{tenantId}/interviews/{sessionId}/…`,
    },
    metadata: ['purpose', 'layout', 'tenant', 'candidate', 'interview'],
    neonTables: ['stored_files', 'interview_artifacts', 'interview_recordings'],
  }
}

/**
 * Stable candidate segment for object keys (prefer auth user id).
 * @param {{ account?: { id?: string } | null, session?: { userId?: string } | null, email?: string }} ctx
 */
export function resolveCandidateStorageId(ctx = {}) {
  if (ctx.account?.id) return sanitizePathSegment(String(ctx.account.id))
  if (ctx.session?.userId) return sanitizePathSegment(String(ctx.session.userId))
  const email = String(ctx.email || '').toLowerCase()
  const fallback = email.replace(/[^a-z0-9._-]+/g, '_') || 'unknown'
  return sanitizePathSegment(fallback)
}

/**
 * S3 user metadata (ASCII, short values). Keys are stored as x-amz-meta-*.
 * @param {{
 *   purpose: string,
 *   tenantId?: string,
 *   candidateId?: string,
 *   interviewId?: string,
 * }} opts
 */
export function buildS3UserMetadata(opts) {
  const purpose = String(opts.purpose || 'object').slice(0, 32)
  /** @type {Record<string, string>} */
  const meta = {
    purpose,
    layout: String(S3_LAYOUT_VERSION),
  }
  if (opts.tenantId) meta.tenant = sanitizePathSegment(opts.tenantId).slice(0, 32)
  if (opts.candidateId) meta.candidate = sanitizePathSegment(opts.candidateId).slice(0, 32)
  if (opts.interviewId) meta.interview = sanitizePathSegment(opts.interviewId).slice(0, 32)
  return meta
}

/**
 * @param {string} key
 * @param {{ allowLegacy?: boolean }} [opts]
 */
export function assertWritableTenantObjectKey(key, opts = {}) {
  const k = String(key || '').trim()
  if (!k) {
    const err = new Error('S3 object key is required.')
    err.status = 400
    throw err
  }
  if (opts.allowLegacy && isLegacyResumeObjectKey(k)) return k
  if (!k.startsWith(`${TENANTS_PREFIX}/`)) {
    const err = new Error('S3 object key must live under tenants/ (production layout).')
    err.status = 400
    throw err
  }
  if (k.includes('..') || k.includes('//')) {
    const err = new Error('S3 object key contains invalid path segments.')
    err.status = 400
    throw err
  }
  return k
}

/**
 * @param {string} key
 */
export function parseTenantObjectKey(key) {
  const k = String(key || '')
  if (isLegacyResumeObjectKey(k)) {
    return { kind: 'legacy_resume', key: k }
  }
  const parts = k.split('/').filter(Boolean)
  if (parts[0] !== TENANTS_PREFIX || parts.length < 3) {
    return { kind: 'unknown', key: k }
  }
  const tenantId = parts[1]
  if (parts[2] === 'candidates' && parts.length >= 5) {
    const candidateId = parts[3]
    if (parts[4] === 'interviews' && parts.length >= 6) {
      const interviewId = parts[5]
      const artifactFolder = parts[6] || ''
      return {
        kind: 'interview_artifact',
        layout: 'candidate_scoped',
        tenantId,
        candidateId,
        interviewId,
        artifactFolder,
        key: k,
      }
    }
    const category = parts[4]
    return {
      kind: category === 'resumes' ? 'resume' : category === 'certificates' ? 'certificate' : 'candidate_file',
      layout: 'candidate_scoped',
      tenantId,
      candidateId,
      category,
      key: k,
    }
  }
  if (parts[2] === 'interviews' && parts.length >= 4) {
    return {
      kind: 'interview_artifact',
      layout: 'flat',
      tenantId,
      interviewId: parts[3],
      artifactFolder: parts[4] || '',
      key: k,
    }
  }
  return { kind: 'tenant_other', tenantId, key: k }
}
