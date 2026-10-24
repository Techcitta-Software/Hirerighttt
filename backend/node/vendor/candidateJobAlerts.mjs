import { resolveCandidateRoleHints, scoreJobRoleAlignment } from './jobRoleMatch.mjs'

const MIN_MATCH_SCORE = 50

/**
 * When an employer publishes a job, record which candidates should be alerted.
 * Stored on the in-memory db snapshot (same session as job create); clients also poll /api/jobs.
 *
 * @param {import('../db/store.mjs').DbShape} db
 * @param {Record<string, unknown>} job
 */
export function queueCandidateJobAlerts(db, job) {
  if (!job?.id) return []
  db.candidateJobAlerts = db.candidateJobAlerts || {}
  const alerted = []
  for (const user of db.users || []) {
    if (user.role === 'employer' || user.status === 'disabled') continue
    const email = String(user.email || '').toLowerCase()
    if (!email) continue
    const profile = db.profiles?.[user.email] || db.profiles?.[email] || {}
    const hints = resolveCandidateRoleHints(profile)
    if (!hints.length) continue
    const score = scoreJobRoleAlignment(job, hints)
    if (score < MIN_MATCH_SCORE) continue
    const row = {
      id: `alert-${job.id}-${email}`,
      jobId: job.id,
      title: String(job.title || 'New role'),
      company: String(job.company || 'Employer'),
      matchScore: score,
      createdAt: new Date().toISOString(),
      read: false,
    }
    const list = db.candidateJobAlerts[email] || []
    if (list.some((a) => a.jobId === job.id)) continue
    list.unshift(row)
    db.candidateJobAlerts[email] = list.slice(0, 50)
    alerted.push(email)
  }
  return alerted
}

/**
 * @param {import('../db/store.mjs').DbShape} db
 * @param {string} email
 */
export function listCandidateJobAlerts(db, email) {
  const key = String(email || '').toLowerCase()
  return (db.candidateJobAlerts?.[key] || []).filter((a) => !a.read)
}
