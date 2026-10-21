/** Candidate-facing job board applications (`job_applications` / db.applications). */

/**
 * @param {string} employerStatus
 * @returns {'Applied' | 'In Review' | 'Interview' | 'Offer'}
 */
export function mapEmployerStatusToCandidateStatus(employerStatus) {
  const map = {
    applied: 'Applied',
    interviewed: 'In Review',
    shortlisted: 'Interview',
    rejected: 'Applied',
  }
  return map[String(employerStatus || 'applied').toLowerCase()] || 'Applied'
}

/**
 * @param {import('../db/store.mjs').SaasJob} job
 * @param {import('../db/store.mjs').EmployerApplication} employerApp
 * @param {{ match?: number | null }} [options]
 */
export function buildCandidateJobApplicationRecord(job, employerApp, options = {}) {
  const data = employerApp.data || {}
  const interviewOverall =
    typeof data.interviewScore === 'number'
      ? data.interviewScore
      : typeof data.interviewResult?.overall === 'number'
        ? data.interviewResult.overall
        : null
  const match =
    typeof options.match === 'number' && Number.isFinite(options.match)
      ? Math.round(options.match)
      : typeof data.atsScore === 'number'
        ? Math.round(data.atsScore)
        : interviewOverall != null
          ? Math.round(interviewOverall)
          : 0

  return {
    id: employerApp.id,
    employerApplicationId: employerApp.id,
    jobId: job.id,
    organizationId: job.organizationId,
    title: job.title,
    company: job.company,
    location: job.location || '',
    roleTrack: job.roleTrack || '',
    experienceLevel: job.experienceLevel || '',
    shareableCode: job.shareableCode,
    companySlug: job.companySlug || null,
    jobDescription: job.jobDescription ? String(job.jobDescription).slice(0, 2000) : '',
    match,
    status: mapEmployerStatusToCandidateStatus(employerApp.status),
    employerStatus: employerApp.status,
    appliedAt: employerApp.appliedAt || new Date().toISOString(),
    atsScore: data.atsScore,
    jdMatchScore: data.jdMatchScore,
    interviewScore: interviewOverall,
    jobStatus: 'active',
  }
}

const JOB_DELETED_MESSAGE = 'This job was removed by the employer.'

/**
 * Mark every candidate `job_applications` row for a deleted posting.
 * @param {import('../db/store.mjs').DbShape} db
 * @param {string} jobId
 * @param {{ title?: string, company?: string }} [meta]
 */
export function markCandidateJobApplicationsDeleted(db, jobId, meta = {}) {
  const id = String(jobId || '').trim()
  if (!id) return { updated: 0, records: [] }
  const deletedAt = new Date().toISOString()
  const patch = {
    jobStatus: 'deleted',
    jobDeletedAt: deletedAt,
    jobDeletedMessage: JOB_DELETED_MESSAGE,
    ...(meta.title ? { title: meta.title } : {}),
    ...(meta.company ? { company: meta.company } : {}),
  }
  const updatedRecords = []
  db.applications = db.applications || {}
  for (const email of Object.keys(db.applications)) {
    const list = db.applications[email]
    if (!Array.isArray(list)) continue
    for (let i = 0; i < list.length; i++) {
      if (String(list[i]?.jobId || '') !== id) continue
      const next = { ...list[i], ...patch }
      list[i] = next
      updatedRecords.push({ email, record: next })
    }
  }
  return { updated: updatedRecords.length, records: updatedRecords }
}

export { JOB_DELETED_MESSAGE }

/**
 * @param {import('../db/store.mjs').DbShape} db
 * @param {string} email
 * @param {import('../db/store.mjs').SaasJob} job
 * @param {import('../db/store.mjs').EmployerApplication} employerApp
 * @param {{ match?: number | null }} [options]
 */
export function recordCandidateJobApplication(db, email, job, employerApp, options = {}) {
  const em = String(email || '').trim().toLowerCase()
  if (!em) {
    throw Object.assign(new Error('Candidate email is required.'), { status: 400 })
  }
  const record = buildCandidateJobApplicationRecord(job, employerApp, options)
  db.applications = db.applications || {}
  const list = Array.isArray(db.applications[em]) ? [...db.applications[em]] : []
  const idx = list.findIndex(
    (row) => row.jobId === job.id || row.id === employerApp.id || row.employerApplicationId === employerApp.id,
  )
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...record }
  } else {
    list.unshift(record)
  }
  db.applications[em] = list
  return record
}
