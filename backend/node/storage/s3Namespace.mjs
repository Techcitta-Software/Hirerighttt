import { isLegacyResumeObjectKey, sanitizePathSegment } from './s3KeyLayout.mjs'

/** Bump when key layout or required metadata changes (see .env.example). */
export const S3_LAYOUT_VERSION = 3

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
 * Layout v3 (current writes) — one folder per asset type under each tenant:
 *
 * tenants/{tenantId}/resumes/{candidateId}/resume_v{n}_{uuid}.ext
 * tenants/{tenantId}/videos/{sessionId}/recording_{uuid8}.ext
 * tenants/{tenantId}/reports/{sessionId}/interview_report.pdf
 * tenants/{tenantId}/transcripts/{sessionId}/transcript.json
 * tenants/{tenantId}/certificates/{candidateId}/{documentId}.ext
 *
 * Legacy (read until purged):
 * - resumes/{email}/…
 * - tenants/{tenantId}/candidates/{candidateId}/… (v2)
 * - tenants/{tenantId}/interviews/{sessionId}/… (v1 flat)
 */
export function describeS3Layout() {
  return {
    version: S3_LAYOUT_VERSION,
    singleBucketEnv: 'S3_BUCKET',
    rootPrefix: `${TENANTS_PREFIX}/`,
    tenantResolution:
      'session organizationId → user primaryOrganizationId → S3_DEFAULT_TENANT_ID (platform)',
    paths: {
      resume: `${TENANTS_PREFIX}/{tenantId}/resumes/{candidateId}/resume_v{n}_{uuid}.{ext}`,
      certificate: `${TENANTS_PREFIX}/{tenantId}/certificates/{candidateId}/{documentId}.{ext}`,
      interviewRecording: `${TENANTS_PREFIX}/{tenantId}/videos/{sessionId}/recording_{uuid8}.{ext}`,
      interviewReport: `${TENANTS_PREFIX}/{tenantId}/reports/{sessionId}/interview_report.pdf`,
      interviewTranscript: `${TENANTS_PREFIX}/{tenantId}/transcripts/{sessionId}/transcript.json`,
      legacyResume: 'resumes/{sanitizedEmail}/{uuid}.{ext}',
      legacyV2CandidateTree: `${TENANTS_PREFIX}/{tenantId}/candidates/{candidateId}/…`,
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

  // v3 type-first
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

  // v2 candidate tree
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
