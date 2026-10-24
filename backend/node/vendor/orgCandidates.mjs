import { listJobApplications } from './jobs.mjs'
import { listOrganizationTalentUserIds, searchCandidateTalent } from '../db/talentIndex.mjs'
import { dbPool } from '../db/store.mjs'

function storedInterviewForEmail(db, email) {
  const key = String(email || '').trim().toLowerCase()
  if (!key) return null
  return db.interviews?.[key] || db.interviews?.[email] || null
}

function findUserByEmailOrId(db, email, userId) {
  if (userId) {
    const byId = (db.users || []).find((u) => u.id === userId)
    if (byId) return byId
  }
  const em = String(email || '').trim().toLowerCase()
  if (!em) return null
  return (db.users || []).find((u) => String(u.email || '').toLowerCase() === em) || null
}

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

/** Recruiters / vendor / employer logins must never appear on the job seeker candidate page. */
export function isEmployerOrRecruiterAccount(db, email, userId, recruiterEmails) {
  const em = String(email || '').trim().toLowerCase()
  if (!em) return true
  if (recruiterEmails?.has(em)) return true
  const user = findUserByEmailOrId(db, email, userId)
  if (!user) return false
  if (user.role === 'employer') return true
  if (user.primaryOrganizationId) {
    const membership = (db.organizationMembers || []).find((m) => m.userId === user.id)
    if (membership && ['owner', 'admin', 'recruiter'].includes(String(membership.role || ''))) {
      return true
    }
  }
  return false
}

function recordFromPostgresJobSeekerRow(db, row) {
  const email = String(row.email || '').toLowerCase()
  const profile = row.profile_data && typeof row.profile_data === 'object' ? row.profile_data : db.profiles?.[email] || {}
  const interview =
    row.interview_data && typeof row.interview_data === 'object'
      ? row.interview_data
      : db.interviews?.[email] || null
  const user = {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role || 'jobseeker',
    phone: row.phone || undefined,
    createdAt: row.created_at,
  }
  return withStoredInterview(db, recordFromProfile(db, user, profile, interview, 'platform'))
}

/** Every job seeker row in Postgres (accounts you created at signup). */
async function loadAllJobSeekerRosterFromPostgres(databaseUrl, db) {
  if (!databaseUrl) return []
  try {
    const res = await dbPool(databaseUrl).query(
      `SELECT
         u.id,
         u.email,
         u.name,
         u.role,
         u.phone,
         u.created_at,
         p.data AS profile_data,
         ir.data AS interview_data
       FROM users u
       LEFT JOIN profiles p ON lower(p.email) = lower(u.email)
       LEFT JOIN interview_results ir ON lower(ir.email) = lower(u.email)
       WHERE LOWER(COALESCE(u.role, 'jobseeker')) = 'jobseeker'
         AND NOT EXISTS (
           SELECT 1 FROM organization_members om
           WHERE om.user_id = u.id
             AND om.role IN ('owner', 'admin', 'recruiter')
         )
       ORDER BY u.created_at DESC`,
    )
    return res.rows.map((row) => recordFromPostgresJobSeekerRow(db, row))
  } catch (err) {
    console.warn('[vendor] jobseeker roster SQL:', err.message)
    return (db.users || [])
      .filter((u) => u.role !== 'employer')
      .map((user) => {
        const profile = db.profiles?.[user.email] || {}
        const interview = db.interviews?.[user.email] || null
        return withStoredInterview(db, recordFromProfile(db, user, profile, interview, 'platform'))
      })
  }
}

/** Attach saved scorecard when application row was not updated after interview. */
function withStoredInterview(db, row) {
  const existing = row.interviewResult
  if (existing && (typeof existing.overall === 'number' || existing.scorecard)) return row
  const stored = storedInterviewForEmail(db, row.candidateEmail)
  if (!stored) return row
  return {
    ...row,
    interviewResult: stored,
    status: row.status === 'New' ? 'In Review' : row.status,
  }
}

function recordFromInterviewReport(db, organizationId, { email, userId, jobId, applicationId, result, completedAt }) {
  const user = (db.users || []).find((u) => u.email === email || u.id === userId)
  const profile = db.profiles?.[email] || {}
  const app = applicationId
    ? (db.employerApplications || []).find(
        (a) => a.id === applicationId && a.organizationId === organizationId,
      )
    : null
  const job = jobId ? (db.jobs || []).find((j) => j.id === jobId && j.organizationId === organizationId) : null
  const data = app?.data || {}

  return withStoredInterview(db, {
    id: app?.id || `report-${user?.id || email}`,
    source: app ? 'application' : 'interview_report',
    organizationId,
    jobId: jobId || app?.jobId || null,
    candidateUserId: user?.id || app?.candidateUserId || null,
    candidateEmail: String(email).toLowerCase(),
    candidateName: String(data.candidateName || profile.fullName || profile.name || user?.name || email).trim(),
    candidatePhone: data.candidatePhone || profile.phone || user?.phone || '',
    candidateRole: String(data.roleTrack || profile.currentRole || job?.roleTrack || job?.title || '').trim(),
    experienceYears: String(data.experienceYears || profile.totalExperience || '').trim(),
    jobTitle: data.jobTitle || job?.title || '',
    company: data.company || job?.company || '',
    resumeName: data.resumeName || profile.resumeName || null,
    resumeText: String(data.resumeText || profile.resumeText || '').slice(0, 50000),
    interviewResult: result,
    atsScore: data.atsScore,
    jdMatchScore: data.jdMatchScore,
    primarySkills: data.primarySkills || job?.requiredSkills || [],
    appliedAt: app?.appliedAt || completedAt || new Date().toISOString(),
    status: 'In Review',
  })
}

async function loadOrgInterviewReports(databaseUrl, organizationId, db) {
  const reports = []
  if (databaseUrl) {
    try {
      const res = await dbPool(databaseUrl).query(
        `SELECT email, user_id, job_id, data, created_at
         FROM interview_result_history
         WHERE organization_id = $1
         ORDER BY created_at DESC`,
        [organizationId],
      )
      for (const row of res.rows) {
        if (!row.data || typeof row.data !== 'object') continue
        reports.push({
          email: row.email,
          userId: row.user_id,
          jobId: row.job_id,
          applicationId: null,
          result: row.data,
          completedAt: row.created_at,
        })
      }
    } catch (err) {
      console.warn('[vendor] interview history roster:', err.message)
    }
  }
  for (const session of Object.values(db.interviewSessions || {})) {
    if (String(session.organizationId || '') !== String(organizationId)) continue
    const result = session.result || storedInterviewForEmail(db, session.email)
    if (!result) continue
    reports.push({
      email: session.email,
      userId: null,
      jobId: session.jobId,
      applicationId: session.applicationId,
      result,
      completedAt: session.completedAt || session.startedAt,
    })
  }
  return reports
}

function statusFromApp(app) {
  const map = {
    applied: 'New',
    interviewed: 'In Review',
    shortlisted: 'Shortlisted',
    rejected: 'Rejected',
  }
  return map[app.status] || 'New'
}

function recordFromApplication(app) {
  const data = app.data || {}
  return {
    id: app.id,
    source: 'application',
    organizationId: app.organizationId,
    jobId: app.jobId,
    candidateUserId: app.candidateUserId || null,
    candidateEmail: app.candidateEmail,
    candidateName: data.candidateName || app.candidateEmail,
    candidatePhone: data.candidatePhone || '',
    candidateRole: data.roleTrack || data.jobTitle || '',
    experienceYears: data.experienceYears || '',
    jobTitle: data.jobTitle || '',
    company: data.company || '',
    resumeName: data.resumeName || null,
    resumeText: data.resumeText || '',
    interviewResult: data.interviewResult || null,
    atsScore: data.atsScore,
    jdMatchScore: data.jdMatchScore,
    primarySkills: data.primarySkills || [],
    appliedAt: app.appliedAt,
    status: statusFromApp(app),
  }
}

function recordFromTalentHit(db, hit) {
  const email = String(hit.email || '').toLowerCase()
  const user = (db.users || []).find((u) => u.email === email || u.id === hit.userId)
  const profile = user ? db.profiles?.[user.email] || {} : {}
  const interview = user ? db.interviews?.[user.email] : null
  const syntheticInterview =
    interview ||
    (typeof hit.interviewScore === 'number'
      ? {
          overall: hit.interviewScore,
          role: hit.currentRole || 'Interview',
          date: hit.updatedAt || new Date().toISOString(),
        }
      : null)
  return {
    id: `talent-${hit.userId}`,
    source: 'talent',
    organizationId: null,
    jobId: null,
    candidateUserId: hit.userId,
    candidateEmail: email,
    candidateName: String(hit.fullName || email).trim(),
    candidatePhone: profile.phone || user?.phone || '',
    candidateRole: String(hit.currentRole || '').trim(),
    experienceYears: String(hit.experienceYears || '').trim(),
    jobTitle: String(hit.currentRole || '').trim(),
    company: '',
    resumeName: profile.resumeName || null,
    resumeText: String(hit.resumePreview || hit.summary || profile.resumeText || '').slice(0, 50000),
    interviewResult: syntheticInterview,
    atsScore: undefined,
    jdMatchScore: undefined,
    primarySkills: hit.skills || [],
    appliedAt: hit.updatedAt || new Date().toISOString(),
    status: syntheticInterview ? 'In Review' : 'New',
  }
}

function recordFromProfile(db, user, profile, interview, accessType) {
  const email = user.email.toLowerCase()
  return {
    id: `talent-${user.id}`,
    source: accessType || 'talent',
    organizationId: null,
    jobId: null,
    candidateUserId: user.id,
    candidateEmail: email,
    candidateName: String(profile.fullName || profile.name || user.name || email).trim(),
    candidatePhone: profile.phone || user.phone || '',
    candidateRole: String(profile.currentRole || profile.whoAreYou || '').trim(),
    experienceYears: String(profile.totalExperience || profile.experienceYears || '').trim(),
    jobTitle: '',
    company: '',
    resumeName: profile.resumeName || null,
    resumeText: String(profile.resumeText || profile.experienceSummary || '').slice(0, 50000),
    interviewResult: interview || null,
    atsScore: undefined,
    jdMatchScore: undefined,
    primarySkills: Array.isArray(profile.skills) ? profile.skills : [],
    appliedAt: profile.updatedAt || user.createdAt || new Date().toISOString(),
    status: interview ? 'In Review' : 'New',
  }
}

function mergeRecords(a, b) {
  const pick = (x, y) => (x && String(x).trim() ? x : y)
  return {
    ...a,
    ...b,
    id: a.source === 'application' ? a.id : b.source === 'application' ? b.id : a.id,
    source: a.source === 'application' || b.source === 'application' ? 'application' : a.source,
    candidateName: pick(a.candidateName, b.candidateName),
    resumeText: pick(a.resumeText, b.resumeText),
    resumeName: pick(a.resumeName, b.resumeName),
    interviewResult: a.interviewResult || b.interviewResult,
    jobId: a.jobId || b.jobId,
    jobTitle: pick(a.jobTitle, b.jobTitle),
    primarySkills: (a.primarySkills?.length ? a.primarySkills : b.primarySkills) || [],
    atsScore: a.atsScore ?? b.atsScore,
    jdMatchScore: a.jdMatchScore ?? b.jdMatchScore,
  }
}

function matchesFilters(row, filters, db, organizationId) {
  const nameQ = String(filters.name || '').trim().toLowerCase()
  const jobQ = String(filters.job || '').trim().toLowerCase()
  const expQ = String(filters.experienceYears || filters.experience || '').trim().toLowerCase()
  const kwQ = String(filters.keywords || filters.q || '').trim().toLowerCase()

  if (nameQ) {
    const hit =
      row.candidateName.toLowerCase().includes(nameQ) ||
      row.candidateEmail.toLowerCase().includes(nameQ)
    if (!hit) return false
  }
  if (jobQ) {
    const hit =
      row.jobTitle.toLowerCase().includes(jobQ) ||
      row.company.toLowerCase().includes(jobQ) ||
      row.candidateRole.toLowerCase().includes(jobQ)
    if (!hit) return false
  }
  if (expQ && !row.experienceYears.toLowerCase().includes(expQ)) return false
  if (kwQ) {
    const hay = [
      row.candidateRole,
      row.candidateName,
      row.jobTitle,
      row.primarySkills?.join(' '),
      row.resumeText,
      row.interviewResult?.role,
      row.interviewResult?.strengths?.join(' '),
      row.interviewResult?.improvements?.join(' '),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    if (!hay.includes(kwQ)) return false
  }
  if (filters.jobId && row.jobId !== filters.jobId) return false
  return true
}

/**
 * All candidates visible to an employer org: job applications + talent access + org vault.
 * @param {import('../db/store.mjs').DbShape} db
 * @param {string} organizationId
 * @param {string} [databaseUrl]
 * @param {Record<string, string>} [filters]
 */
export async function listOrganizationCandidates(db, organizationId, databaseUrl, filters = {}) {
  const recruiterEmails = buildRecruiterTeamEmailSet(db)
  const byKey = new Map()

  const add = (row) => {
    if (!row?.candidateEmail) return
    if (isEmployerOrRecruiterAccount(db, row.candidateEmail, row.candidateUserId, recruiterEmails)) {
      return
    }
    const key = row.candidateUserId || row.candidateEmail.toLowerCase()
    const prev = byKey.get(key)
    byKey.set(key, prev ? mergeRecords(prev, row) : row)
  }

  for (const app of db.employerApplications || []) {
    if (app.organizationId !== organizationId) continue
    add(withStoredInterview(db, recordFromApplication(app)))
  }

  for (const vault of db.confidentialVault || []) {
    if (vault.organizationId !== organizationId) continue
    add({
      id: vault.id,
      source: 'vault',
      organizationId,
      jobId: null,
      candidateUserId: null,
      candidateEmail: vault.email,
      candidateName: vault.name,
      candidatePhone: vault.phone || '',
      candidateRole: vault.currentRole || '',
      experienceYears: vault.experienceYears || '',
      jobTitle: vault.currentRole || '',
      company: '',
      resumeName: vault.resumeName || null,
      resumeText: vault.resumeText || '',
      interviewResult: vault.interviewResult || null,
      atsScore: undefined,
      jdMatchScore: undefined,
      primarySkills: vault.skills || [],
      appliedAt: vault.createdAt,
      status: vault.status || 'New',
    })
  }

  if (databaseUrl) {
    try {
      const userIds = await listOrganizationTalentUserIds(databaseUrl, organizationId)
      for (const userId of userIds) {
        const user = db.users.find((u) => u.id === userId)
        if (!user || user.role === 'employer') continue
        const profile = db.profiles?.[user.email] || {}
        const interview = db.interviews?.[user.email] || null
        add(withStoredInterview(db, recordFromProfile(db, user, profile, interview, 'interview')))
      }
    } catch (err) {
      console.warn('[vendor] talent access list:', err.message)
    }
  }

  const reports = await loadOrgInterviewReports(databaseUrl, organizationId, db)
  const seenReportEmail = new Set()
  for (const report of reports) {
    const emailKey = String(report.email || '').toLowerCase()
    if (!emailKey || seenReportEmail.has(emailKey)) continue
    seenReportEmail.add(emailKey)
    add(recordFromInterviewReport(db, organizationId, report))
  }

  const platformRows = await loadAllJobSeekerRosterFromPostgres(databaseUrl, db)
  for (const row of platformRows) {
    add(row)
  }

  if (databaseUrl) {
    try {
      const searchQ = [filters.keywords, filters.name, filters.q].filter(Boolean).join(' ').trim()
      const talent = await searchCandidateTalent(databaseUrl, organizationId, {
        q: searchQ,
        experienceYears: filters.experienceYears || filters.experience || '',
        limit: 250,
        offset: 0,
      })
      for (const hit of talent.candidates || []) {
        add(withStoredInterview(db, recordFromTalentHit(db, hit)))
      }
    } catch (err) {
      console.warn('[vendor] talent roster merge:', err.message)
    }
  }

  let candidates = Array.from(byKey.values()).map((row) => withStoredInterview(db, row))
  candidates = candidates.filter(
    (row) =>
      !isEmployerOrRecruiterAccount(db, row.candidateEmail, row.candidateUserId, recruiterEmails) &&
      matchesFilters(row, filters, db, organizationId),
  )
  candidates.sort((a, b) => String(b.appliedAt).localeCompare(String(a.appliedAt)))

  if (databaseUrl && candidates.length) {
    candidates = await attachInterviewRecordingFlags(databaseUrl, candidates)
  }

  return { total: candidates.length, candidates }
}

/** Lightweight EXISTS-style flag — no presigned URLs on list. */
async function attachInterviewRecordingFlags(databaseUrl, candidates) {
  const emails = [...new Set(candidates.map((c) => String(c.candidateEmail || '').toLowerCase()).filter(Boolean))]
  if (!emails.length) return candidates
  try {
    const activeBucket = (process.env.S3_BUCKET || '').trim()
    const res = await dbPool(databaseUrl).query(
      `SELECT lower(candidate_email) AS email
       FROM interview_recordings
       WHERE lower(candidate_email) = ANY($1::text[])
         AND status IN ('uploaded', 'completed')
         AND ($2 = '' OR bucket = $2)
       GROUP BY lower(candidate_email)`,
      [emails, activeBucket],
    )
    const withRecording = new Set(res.rows.map((r) => r.email))
    return candidates.map((c) => ({
      ...c,
      interviewRecordingAvailable: withRecording.has(String(c.candidateEmail || '').toLowerCase()),
    }))
  } catch (err) {
    console.warn('[vendor] recording flags:', err.message)
    return candidates
  }
}

/** Applicants for one job only (same org). */
export function listJobCandidates(db, organizationId, jobId, filters = {}) {
  const recruiterEmails = buildRecruiterTeamEmailSet(db)
  const apps = listJobApplications(db, organizationId, jobId).filter(
    (app) =>
      !isEmployerOrRecruiterAccount(db, app.candidateEmail, app.candidateUserId, recruiterEmails),
  )
  let candidates = apps.map((app) => withStoredInterview(db, recordFromApplication(app)))
  for (const session of Object.values(db.interviewSessions || {})) {
    if (String(session.organizationId || '') !== String(organizationId)) continue
    if (String(session.jobId || '') !== String(jobId)) continue
    const result = session.result || storedInterviewForEmail(db, session.email)
    if (!result) continue
    const row = recordFromInterviewReport(db, organizationId, {
      email: session.email,
      jobId,
      applicationId: session.applicationId,
      result,
      completedAt: session.completedAt,
    })
    if (
      row.jobId === jobId &&
      !isEmployerOrRecruiterAccount(db, row.candidateEmail, row.candidateUserId, recruiterEmails)
    ) {
      candidates.push(row)
    }
  }
  const byEmail = new Map()
  for (const row of candidates) {
    const key = row.candidateEmail.toLowerCase()
    const prev = byEmail.get(key)
    byEmail.set(key, prev ? mergeRecords(prev, row) : row)
  }
  candidates = Array.from(byEmail.values())
  candidates = candidates.filter(
    (row) =>
      !isEmployerOrRecruiterAccount(db, row.candidateEmail, row.candidateUserId, recruiterEmails) &&
      matchesFilters(row, { ...filters, jobId }, db, organizationId),
  )
  return { total: candidates.length, candidates, jobId }
}
