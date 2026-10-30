import { isLegacyResumeObjectKey, sanitizePathSegment, USERS_PREFIX } from './s3KeyLayout.mjs'

/** Bump when key layout or required metadata changes (see .env.example). */
export const S3_LAYOUT_VERSION = 4

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
 * Layout v4 (current writes) — browse S3 as users → user id → four folders:
 *
 * users/{userId}/resume/resume.pdf
 * users/{userId}/video/{sessionId}.webm
 * users/{userId}/report/{sessionId}.pdf
 * users/{userId}/transcript/{sessionId}.json
 *
 * Optional (same resume folder): certificate_{id}.pdf, video/proctor_{session}_{flag}.jpg
 *
 * Legacy (read until purged): tenants/…, resumes/…, candidates/…
 */
export function describeS3Layout() {
  return {
    version: S3_LAYOUT_VERSION,
    singleBucketEnv: 'S3_BUCKET',
    rootPrefix: `${USERS_PREFIX}/`,
    tenantResolution:
      'metadata only (session organizationId → user primaryOrganizationId); object keys are user-scoped',
    paths: {
      resume: `${USERS_PREFIX}/{userId}/resume/resume.{ext}`,
      certificate: `${USERS_PREFIX}/{userId}/resume/certificate_{documentId}.{ext}`,
      interviewRecording: `${USERS_PREFIX}/{userId}/video/{sessionId}.{ext}`,
      interviewReport: `${USERS_PREFIX}/{userId}/report/{sessionId}.pdf`,
      interviewTranscript: `${USERS_PREFIX}/{userId}/transcript/{sessionId}.json`,
      proctorSnapshot: `${USERS_PREFIX}/{userId}/video/proctor_{sessionId}_{flagId}.jpg`,
      legacyResume: 'resumes/{sanitizedEmail}/{uuid}.{ext}',
      legacyTenants: `${TENANTS_PREFIX}/…`,
      legacyCandidates: 'candidates/{userId}/…',
    },
    metadata: ['purpose', 'layout', 'tenant', 'candidate', 'interview'],
    neonTables: ['stored_files', 'interview_artifacts', 'interview_recordings'],
  }
}

/**
 * Stable user id segment for object keys (prefer auth user id).
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
  if (!k.startsWith(`${USERS_PREFIX}/`)) {
    const err = new Error('S3 object key must live under users/ (production layout).')
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

  if (parts[0] === USERS_PREFIX && parts.length >= 3) {
    const userId = parts[1]
    const folder = parts[2]
    if (folder === 'resume') {
      return { kind: 'resume', layout: 'user_scoped', userId, category: 'resume', key: k }
    }
    if (folder === 'video') {
      return {
        kind: 'interview_artifact',
        layout: 'user_scoped',
        userId,
        artifactFolder: 'video',
        key: k,
      }
    }
    if (folder === 'report') {
      return {
        kind: 'interview_artifact',
        layout: 'user_scoped',
        userId,
        artifactFolder: 'report',
        key: k,
      }
    }
    if (folder === 'transcript') {
      return {
        kind: 'interview_artifact',
        layout: 'user_scoped',
        userId,
        artifactFolder: 'transcript',
        key: k,
      }
    }
  }

  if (parts[0] === 'candidates' && parts.length >= 3) {
    const userId = parts[1]
    const folder = parts[2]
    return {
      kind: folder === 'resume' ? 'resume' : 'interview_artifact',
      layout: 'legacy_candidates',
      userId,
      artifactFolder: folder,
      key: k,
    }
  }

  if (parts[0] !== TENANTS_PREFIX || parts.length < 3) {
    return { kind: 'unknown', key: k }
  }
  const tenantId = parts[1]

  if (parts[2] === 'resumes' && parts.length >= 4) {
    return {
      kind: 'resume',
      layout: 'type_first',
      tenantId,
      candidateId: parts[3],
      category: 'resumes',
      key: k,
    }
  }
  if (parts[2] === 'videos' && parts.length >= 4) {
    return {
      kind: 'interview_artifact',
      layout: 'type_first',
      tenantId,
      interviewId: parts[3],
      artifactFolder: 'videos',
      key: k,
    }
  }
  if (parts[2] === 'reports' && parts.length >= 4) {
    return {
      kind: 'interview_artifact',
      layout: 'type_first',
      tenantId,
      interviewId: parts[3],
      artifactFolder: 'reports',
      key: k,
    }
  }
  if (parts[2] === 'transcripts' && parts.length >= 4) {
    return {
      kind: 'interview_artifact',
      layout: 'type_first',
      tenantId,
      interviewId: parts[3],
      artifactFolder: 'transcripts',
      key: k,
    }
  }
  if (parts[2] === 'certificates' && parts.length >= 4) {
    return {
      kind: 'certificate',
      layout: 'type_first',
      tenantId,
      candidateId: parts[3],
      category: 'certificates',
      key: k,
    }
  }

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
