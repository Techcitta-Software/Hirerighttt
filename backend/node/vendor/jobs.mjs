import { randomBytes } from 'node:crypto'
import { computeAtsScore } from './atsScore.mjs'

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
  if (!title || !jobDescription) {
    const err = new Error('title and jobDescription are required.')
    err.status = 400
    throw err
  }
  const skillsRaw = body.requiredSkills
  const requiredSkills = Array.isArray(skillsRaw)
    ? skillsRaw.map((s) => String(s).trim()).filter(Boolean)
    : String(body.skills || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

  let shareableCode = newShareableCode()
  const existing = new Set((db.jobs || []).map((j) => j.shareableCode))
  while (existing.has(shareableCode)) shareableCode = newShareableCode()

  const user = db.users.find((u) => u.id === createdByUserId)
  const job = {
    id: newId(),
    organizationId,
    createdByUserId,
    title,
    company: String(body.company || user?.companyName || 'Organization').trim(),
    roleTrack: String(body.roleTrack || body.role || 'Software Engineer').trim(),
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

/** @param {import('../db/store.mjs').DbShape} db */
export function getJobByShareableCode(db, code) {
  const c = String(code || '').trim().toLowerCase()
  return (db.jobs || []).find(
    (j) => j.status !== 'archived' && String(j.shareableCode || '').toLowerCase() === c,
  )
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
  if (dup) return { application: dup, created: false }

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
    title: job.title,
    company: job.company,
    roleTrack: job.roleTrack,
    experienceLevel: job.experienceLevel,
    location: job.location,
    jobDescription: job.jobDescription,
    requiredSkills: job.requiredSkills || [],
    shareableCode: job.shareableCode,
  }
}
