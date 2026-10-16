import { randomBytes } from 'node:crypto'
import { findJobByShareableCode } from '../db/store.mjs'
import { computeAtsScore, extractPrimarySkillsFromJd } from './atsScore.mjs'

export function slugifyCompanyName(name) {
  const base = String(name || 'company')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return base || 'company'
}

export function newShareableCode() {
  return randomBytes(5).toString('hex')
}

export function newId() {
  return randomBytes(8).toString('hex')
}

/**
 * @param {import('../db/store.mjs').DbShape} db
 * @param {string} organizationId
 * @param {string} createdByUserId
 * @param {Record<string, unknown>} body
 */
export function createVendorJob(db, organizationId, createdByUserId, body) {
  const title = String(body.title || '').trim()
  const jobDescription = String(body.jobDescription || '').trim()
  if (!title || title.length > 200 || jobDescription.length < 30 || jobDescription.length > 20000) {
    const err = new Error('Provide a title (up to 200 characters) and complete JD (30–20,000 characters).')
    err.status = 400
    throw err
  }
  const skillsRaw = body.requiredSkills
  let requiredSkills = Array.isArray(skillsRaw)
    ? skillsRaw.map((s) => String(s).trim()).filter(Boolean)
    : String(body.skills || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
  if (!requiredSkills.length) {
    requiredSkills = extractPrimarySkillsFromJd(jobDescription, [])
  }
  if (requiredSkills.length > 40 || requiredSkills.some(skill => skill.length > 100)) {
    throw Object.assign(new Error('Provide at most 40 skills, each up to 100 characters.'), { status: 400 })
  }

  let shareableCode = newShareableCode()
  const existing = new Set((db.jobs || []).map((j) => j.shareableCode))
  while (existing.has(shareableCode)) shareableCode = newShareableCode()

  const user = db.users.find((u) => u.id === createdByUserId)
  const company = String(body.company || user?.companyName || 'Organization').trim()
  const job = {
    id: newId(),
    organizationId,
    createdByUserId,
    title,
    company,
    companySlug: slugifyCompanyName(company),
    roleTrack: String(body.roleTrack || body.role || title).trim(),
    experienceLevel: String(body.experienceLevel || body.experience || '2–5 years').trim(),
    location: String(body.location || 'Remote').trim(),
    jobDescription,
    requiredSkills,
    shareableCode,
    status: 'active',
    createdAt: new Date().toISOString(),
    createdByEmail: user?.email,
  }
  db.jobs = db.jobs || []
  db.jobs.push(job)
  return job
}

function normalizeShareableCode(code) {
  try {
    return decodeURIComponent(String(code || '').trim()).toLowerCase()
  } catch {
    return String(code || '').trim().toLowerCase()
  }
}

function isJobLinkActive(job) {
  const status = String(job?.status || 'published').toLowerCase()
  return status === 'active' || status === 'published'
}

/** @param {import('../db/store.mjs').DbShape} db */
export function getJobByShareableCode(db, code, companySlug = null) {
  const c = normalizeShareableCode(code)
  if (!c) return null
  const slug = companySlug ? slugifyCompanyName(companySlug) : null
  const matches = (db.jobs || []).filter((j) => {
    if (!isJobLinkActive(j)) return false
    return String(j.shareableCode || '').toLowerCase() === c
  })
  if (!matches.length) return null
  if (!slug || matches.length === 1) return matches[0]
  const bySlug = matches.find((j) => {
    const jobSlug = j.companySlug || slugifyCompanyName(j.company)
    return jobSlug === slug
  })
  return bySlug || matches[0]
}

/** Cache + Postgres resolution for public /apply links. */
export async function resolvePublicJob(db, databaseUrl, code, companySlug = null) {
  let job = getJobByShareableCode(db, code, companySlug)
  if (!job) job = getJobByShareableCode(db, code, null)
  if (!job && databaseUrl) {
    const fromDb = await findJobByShareableCode(databaseUrl, code)
    if (fromDb) {
      job = fromDb
      db.jobs = db.jobs || []
      const idx = db.jobs.findIndex((j) => j.id === fromDb.id)
      if (idx >= 0) db.jobs[idx] = { ...db.jobs[idx], ...fromDb }
      else db.jobs.push(fromDb)
    }
  }
  return job
}

export function parsePublicJobPath(pathname) {
  const raw = String(pathname || '')
    .replace(/^\/api\/jobs\/public\/?/i, '')
    .split('/')
    .filter(Boolean)
  const isApply = raw[raw.length - 1] === 'apply'
  const segments = isApply ? raw.slice(0, -1) : raw
  const companySlug = segments.length >= 2 ? decodePathSegment(segments[0]) : null
  const code = decodePathSegment(segments.length >= 2 ? segments[1] : segments[0])
  return { code, companySlug, isApply }
}

function decodePathSegment(segment) {
  if (!segment) return ''
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/** @param {import('../db/store.mjs').DbShape} db */
export function listOpenJobs(db) {
  return (db.jobs || [])
    .filter((j) => j.status === 'active' && j.createdByUserId && j.title)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

/** @param {import('../db/store.mjs').DbShape} db */
export function listOrgJobs(db, organizationId) {
  return (db.jobs || [])
    .filter((j) => j.organizationId === organizationId && j.status !== 'archived')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

/** @param {import('../db/store.mjs').DbShape} db */
export function getOrgJob(db, organizationId, jobId) {
  return (db.jobs || []).find((j) => j.id === jobId && j.organizationId === organizationId)
}

/**
 * @param {import('../db/store.mjs').DbShape} db
 * @param {import('../db/store.mjs').SaasJob} job
 */
export function createJobApplication(db, job, payload) {
  const email = String(payload.candidateEmail || '').trim().toLowerCase()
  if (!email) {
    const err = new Error('candidateEmail is required.')
    err.status = 400
    throw err
  }
  db.employerApplications = db.employerApplications || []
  const dup = db.employerApplications.find(
    (a) => a.jobId === job.id && a.candidateEmail === email,
  )
  if (dup) {
    if (dup.candidateUserId && dup.candidateUserId !== payload.candidateUserId) throw Object.assign(new Error('Application belongs to another account.'), { status: 403 })
    dup.candidateUserId = payload.candidateUserId || dup.candidateUserId
    return { application: dup, created: false }
  }

  const resumeText = String(payload.resumeText || '')
  const ats =
    payload.atsEvaluation ||
    computeAtsScore({
      resumeText,
      jobDescription: job.jobDescription || '',
      requiredSkills: job.requiredSkills || [],
    })

  const application = {
    id: newId(),
    organizationId: job.organizationId,
    jobId: job.id,
    candidateEmail: email,
    candidateUserId: payload.candidateUserId || null,
    status: 'applied',
    appliedAt: new Date().toISOString(),
    data: {
      candidateName: String(payload.candidateName || '').trim(),
      candidatePhone: String(payload.candidatePhone || '').trim(),
      experienceYears: String(payload.experienceYears || '').trim(),
      resumeName: String(payload.resumeName || 'resume'),
      resumeText: resumeText.slice(0, 50000),
      atsScore: ats.atsScore,
      jdMatchScore: ats.jdMatchScore,
      resumeSkillCoverage: ats.resumeSkillCoverage,
      primarySkills: ats.primarySkills,
      matchedSkills: ats.matchedSkills,
      missingSkills: ats.missingSkills,
      atsStrengths: ats.strengths || [],
      atsGaps: ats.gaps || [],
      atsSummary: ats.summary || '',
      atsConfidence: ats.confidence || 'medium',
      aiEnhancedAts: Boolean(ats.aiEnhanced),
      interviewScore: null,
      interviewResult: null,
      vendorReport: null,
      jobTitle: job.title,
      company: job.company,
      roleTrack: job.roleTrack,
    },
  }
  db.employerApplications.push(application)
  return { application, created: true, ats }
}

/** @param {import('../db/store.mjs').DbShape} db */
export function listJobApplications(db, organizationId, jobId) {
  return (db.employerApplications || [])
    .filter((a) => a.organizationId === organizationId && a.jobId === jobId)
    .sort((a, b) => String(b.appliedAt).localeCompare(String(a.appliedAt)))
}

/** @param {import('../db/store.mjs').DbShape} db */
export function updateApplicationInterview(db, applicationId, organizationId, result, extra = {}) {
  const app = (db.employerApplications || []).find(
    (a) => a.id === applicationId && a.organizationId === organizationId,
  )
  if (!app) return null
  app.status = 'interviewed'
  app.data = {
    ...app.data,
    interviewScore: result.overall,
    interviewResult: result,
    resumeFitScore: result.resumeFitScore,
    evaluatedAt: new Date().toISOString(),
    vendorReport: extra.vendorReport ?? app.data.vendorReport ?? null,
    ...extra,
  }
  return app
}

/** @param {import('../db/store.mjs').DbShape} db */
export function getOrgApplication(db, organizationId, applicationId) {
  return (db.employerApplications || []).find(
    (a) => a.id === applicationId && a.organizationId === organizationId,
  )
}

export function publicJobPayload(job) {
  return {
    id: job.id,
    organizationId: job.organizationId,
    title: job.title,
    company: job.company,
    companySlug: job.companySlug || slugifyCompanyName(job.company),
    roleTrack: job.roleTrack,
    experienceLevel: job.experienceLevel,
    location: job.location,
    jobDescription: job.jobDescription,
    requiredSkills: job.requiredSkills || [],
    shareableCode: job.shareableCode,
    createdAt: job.createdAt,
  }
}
