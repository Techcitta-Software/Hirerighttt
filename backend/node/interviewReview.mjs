import { assertVendorMayViewCandidateDocuments } from './vendor/candidateDocuments.mjs'

const TYPES = new Set(['NO_FACE_SEEN', 'MULTIPLE_FACES_DETECTED', 'SIDE_GAZE_LOOKING_AWAY', 'UNABLE_TO_ASSESS'])

export function mergeReviewEvents(existing, incoming) {
  if (!Array.isArray(incoming) || incoming.length > 1000) throw new Error('Invalid review event batch.')
  const events = new Map((existing || []).map(e => [e.id, e]))
  for (const e of incoming) {
    if (!e || typeof e.id !== 'string' || e.id.length > 100 || !TYPES.has(e.eventType) ||
        !Number.isFinite(e.startOffsetSec) || !Number.isFinite(e.durationSec) ||
        e.startOffsetSec < 0 || e.durationSec < 0 || e.startOffsetSec + e.durationSec > 86400 ||
        !Number.isFinite(Date.parse(e.timestamp))) throw new Error('Invalid review event.')
    const previous = events.get(e.id)
    if (previous && (previous.eventType !== e.eventType || previous.startOffsetSec !== e.startOffsetSec)) throw new Error('Event identity cannot change.')
    events.set(e.id, {
      id: e.id, eventType: e.eventType, startOffsetSec: e.startOffsetSec,
      durationSec: Math.max(previous?.durationSec || 0, e.durationSec),
      timestamp: new Date(e.timestamp).toISOString(), formattedTime: String(e.formattedTime || '').slice(0, 30),
      message: String(e.message || '').slice(0, 500), severity: 'warn', reviewOnly: true,
      candidateExplanation: previous?.candidateExplanation || '',
    })
  }
  if (events.size > 1000) throw new Error('Review event limit reached.')
  return [...events.values()].sort((a, b) => a.startOffsetSec - b.startOffsetSec)
}

export function canReviewRecording(tenantId, row) {
  return Boolean(tenantId && row && row.tenant_id === tenantId)
}

/**
 * Employer may stream org-scoped recordings or platform (B2C) practice interviews
 * for candidates visible in their roster.
 * @param {import('./db/store.mjs').DbShape} db
 */
/** Employer may load integrity events for this session (org interview or platform practice). */
export function vendorMayViewInterviewSession(session, organizationId, candidateEmail) {
  if (!session) return false
  const expected = String(candidateEmail || '').trim().toLowerCase()
  const sessionEmail = String(session.email || '').trim().toLowerCase()
  if (!expected || !sessionEmail || sessionEmail !== expected) return false
  const platform = (process.env.S3_DEFAULT_TENANT_ID || 'platform').trim() || 'platform'
  const sessionOrg = session.organizationId ? String(session.organizationId).trim() : platform
  const orgId = String(organizationId || '').trim()
  if (!orgId) return false
  return sessionOrg === orgId || sessionOrg === platform
}

export function employerCanReviewRecording(db, organizationId, candidateEmail, row) {
  if (!row) return false
  if (row.status !== 'uploaded' && row.status !== 'completed') return false
  const orgId = String(organizationId || '').trim()
  if (!orgId) return false
  if (String(row.tenant_id) === orgId) return true
  const platform = (process.env.S3_DEFAULT_TENANT_ID || 'platform').trim() || 'platform'
  if (String(row.tenant_id) !== platform) return false
  try {
    assertVendorMayViewCandidateDocuments(db, orgId, candidateEmail)
    return true
  } catch {
    return false
  }
}
