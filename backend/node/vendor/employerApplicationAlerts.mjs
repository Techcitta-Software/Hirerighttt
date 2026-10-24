import { jobVisibleToRecruiter } from './jobs.mjs'

/**
 * In-memory alerts when a candidate applies to an org's job (shown on vendor dashboard).
 * @param {import('../db/store.mjs').DbShape} db
 */

export function queueEmployerApplicationAlert(db, job, application, created = true) {
  if (!created || !job?.organizationId || !application?.id) return null
  db.employerApplicationAlerts = db.employerApplicationAlerts || {}
  const orgId = job.organizationId
  const list = db.employerApplicationAlerts[orgId] || []
  const name =
    application.data?.candidateName?.trim() ||
    application.candidateEmail ||
    'A candidate'
  const row = {
    id: `app-alert-${application.id}`,
    applicationId: application.id,
    jobId: job.id,
    jobTitle: job.title,
    candidateName: name,
    candidateEmail: application.candidateEmail,
    hasInterviewReport: Boolean(application.data?.interviewResult),
    hasResume: Boolean(
      application.data?.resumeText?.trim() ||
        application.data?.resumeStoragePath ||
        application.data?.resumeFileId,
    ),
    createdAt: new Date().toISOString(),
    read: false,
  }
  if (list.some((a) => a.applicationId === application.id)) return row
  list.unshift(row)
  db.employerApplicationAlerts[orgId] = list.slice(0, 40)
  return row
}

/** Backfill unread alerts from recent applications (e.g. after server restart). */
export function ensureEmployerApplicationAlertsFromApplications(db, organizationId) {
  db.employerApplicationAlerts = db.employerApplicationAlerts || {}
  const list = db.employerApplicationAlerts[organizationId] || []
  const known = new Set(list.map((a) => a.applicationId))
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000
  for (const app of db.employerApplications || []) {
    if (app.organizationId !== organizationId || known.has(app.id)) continue
    const appliedMs = new Date(app.appliedAt || app.createdAt || 0).getTime()
    if (!appliedMs || appliedMs < cutoff) continue
    const job = (db.jobs || []).find((j) => j.id === app.jobId && j.organizationId === organizationId)
    queueEmployerApplicationAlert(db, job || { organizationId, id: app.jobId, title: app.data?.jobTitle || 'Role' }, app, true)
    known.add(app.id)
  }
}

/** @param {import('../db/store.mjs').DbShape} db @param {string} organizationId */
export function listEmployerApplicationAlerts(db, organizationId, options = {}) {
  ensureEmployerApplicationAlertsFromApplications(db, organizationId)
  const unreadOnly = options.unreadOnly !== false
  let list = db.employerApplicationAlerts?.[organizationId] || []
  if (options.createdByUserId) {
    list = list.filter((a) => {
      const job = (db.jobs || []).find(
        (j) => j.id === a.jobId && j.organizationId === organizationId,
      )
      return jobVisibleToRecruiter(job || {}, options)
    })
  }
  return unreadOnly ? list.filter((a) => !a.read) : list
}

export function markEmployerApplicationAlertsRead(db, organizationId, ids = null) {
  db.employerApplicationAlerts = db.employerApplicationAlerts || {}
  const list = db.employerApplicationAlerts[organizationId] || []
  db.employerApplicationAlerts[organizationId] = list.map((a) => {
    if (ids && !ids.includes(a.id)) return a
    if (!ids || ids.includes(a.id)) return { ...a, read: true }
    return a
  })
}
