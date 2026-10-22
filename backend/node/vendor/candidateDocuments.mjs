import { isEmployerOrRecruiterAccount } from './orgCandidates.mjs'

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
export function assertVendorMayViewCandidateDocuments(db, organizationId, candidateEmail) {
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

  const linkedApplication = (db.employerApplications || []).some(
    (app) =>
      String(app.organizationId || '') === String(organizationId || '') &&
      String(app.candidateEmail || '').toLowerCase() === email,
  )
  const linkedSession = Object.values(db.interviewSessions || {}).some(
    (session) =>
      String(session.organizationId || '') === String(organizationId || '') &&
      String(session.email || '').toLowerCase() === email,
  )
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
