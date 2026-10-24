import { isEmployerOrRecruiterAccount } from './orgCandidates.mjs'
import { listOrgJobs } from './jobs.mjs'

function buildRecruiterTeamEmailSet(db) {
  const emails = new Set()
  for (const member of db.organizationMembers || []) {
    if (!['owner', 'admin', 'recruiter'].includes(String(member.role || ''))) continue
    const user = (db.users || []).find((u) => u.id === member.userId)
    if (user?.email) emails.add(String(user.email).toLowerCase())
  }
  for (const user of db.users || []) {
    if (user.role === 'employer' && user.email) {
      emails.add(String(user.email).toLowerCase())
    }
  }
  return emails
}

/**
 * Vendor may view stored resume/report for job seekers visible in their talent roster
 * or linked to their organization via applications / interviews.
 */
/**
 * @param {{ createdByUserId?: string, createdByEmail?: string }} [recruiterScope]
 */
export function assertVendorMayViewCandidateDocuments(
  db,
  organizationId,
  candidateEmail,
  recruiterScope = null,
) {
  const email = String(candidateEmail || '').trim().toLowerCase()
  if (!email) {
    const err = new Error('Candidate email is required.')
    err.status = 400
    throw err
  }
  const recruiters = buildRecruiterTeamEmailSet(db)
  if (isEmployerOrRecruiterAccount(db, email, null, recruiters)) {
    const err = new Error('Candidate not found.')
    err.status = 404
    throw err
  }

  const recruiterJobIds = recruiterScope?.createdByUserId
    ? new Set(listOrgJobs(db, organizationId, recruiterScope).map((j) => j.id))
    : null
  const linkedApplication = (db.employerApplications || []).some((app) => {
    if (String(app.organizationId || '') !== String(organizationId || '')) return false
    if (String(app.candidateEmail || '').toLowerCase() !== email) return false
    if (recruiterJobIds && app.jobId && !recruiterJobIds.has(app.jobId)) return false
    return true
  })
  const linkedSession = Object.values(db.interviewSessions || {}).some((session) => {
    if (String(session.organizationId || '') !== String(organizationId || '')) return false
    if (String(session.email || '').toLowerCase() !== email) return false
    if (recruiterJobIds && session.jobId && !recruiterJobIds.has(session.jobId)) return false
    return true
  })
  const jobSeekerUser = (db.users || []).find(
    (u) => String(u.email || '').toLowerCase() === email && u.role !== 'employer',
  )

  if (!linkedApplication && !linkedSession && !jobSeekerUser) {
    const err = new Error('Candidate not found.')
    err.status = 404
    throw err
  }
}

/**
 * @param {import('../db/store.mjs').DbShape} db
 * @param {string} candidateEmail
 */
export function candidateProfileForDocuments(db, candidateEmail) {
  const email = String(candidateEmail || '').trim().toLowerCase()
  return /** @type {Record<string, unknown>} */ (db.profiles?.[email] || {})
}
