import type { EmployerApplicant, EmployerApplicantApplication } from '../../lib/store'

/**
 * A person who applied to several jobs of the organisation is one row (the interviewed application). Filtered by
 * one of the OTHER jobs, the row must show that job's application: its id (so its rank is looked up), title,
 * status and ATS / JD scores. The interview stays (the job's ranking uses it too) and is attributed to its own job.
 */
export function projectApplicantToJobs(a: EmployerApplicant, jobIds: readonly string[]): EmployerApplicant {
  if (!jobIds.length || !a.applications?.length || jobIds.includes(a.jobId)) return a
  const app = a.applications.find((x) => x.jobId && jobIds.includes(x.jobId))
  if (!app) return a
  const interviewJobId = a.interviewJobId ?? (a.interviewResult ? a.jobId : null)
  return {
    ...a,
    id: app.applicationId || a.id,
    jobId: app.jobId,
    jobTitle: app.jobTitle || a.jobTitle,
    status: (app.status as EmployerApplicant['status']) || a.status,
    atsScore: app.atsScore ?? undefined,
    jdMatchScore: app.jdMatchScore ?? undefined,
    appliedAt: app.appliedAt || a.appliedAt,
    interviewJobId,
    // Not this job's own interview: the score is the candidate's interview for another job.
    ...(a.interviewResult && interviewJobId && interviewJobId !== app.jobId ? { interviewSource: 'general' as const } : {}),
    // Rank and ranking inputs belong to the other application; this one's come from its own job ranking.
    rank: undefined,
    roleSkillsFit: undefined,
    matchedSkills: undefined,
    missingSkills: undefined,
    interviewCompletedAt: undefined,
  }
}

export function projectApplicantsToJobs(rows: EmployerApplicant[], jobIds: readonly string[]): EmployerApplicant[] {
  if (!jobIds.length) return rows
  return rows.map((a) => projectApplicantToJobs(a, jobIds))
}

function uniqueTitles(apps: EmployerApplicantApplication[]): string[] {
  return Array.from(new Set(apps.map((x) => x.jobTitle?.trim()).filter((t): t is string => Boolean(t))))
}

/** "Applied to: Frontend Engineer, Backend Engineer" (every job of this organisation), '' when there is no job. */
export function appliedJobsLabel(a: Pick<EmployerApplicant, 'jobTitle' | 'applications'>): string {
  const titles = a.applications?.length ? uniqueTitles(a.applications) : []
  if (titles.length > 1) return `Applied to: ${titles.join(', ')}`
  return a.jobTitle ? `Applied to: ${a.jobTitle}` : ''
}

/** Which job the shown interview score belongs to, when the person applied to more than one job. */
export function scoreJobTitle(
  a: Pick<EmployerApplicant, 'applications' | 'interviewJobId' | 'jobId' | 'jobTitle' | 'interviewResult'>,
): string {
  if (!a.interviewResult || (a.applications?.length ?? 0) < 2) return ''
  const jobId = a.interviewJobId ?? a.jobId
  const app = a.applications?.find((x) => x.jobId === jobId)
  return app?.jobTitle || (jobId === a.jobId ? a.jobTitle : '')
}

/** Find a row by any of its application ids (the drawer link keeps working when the job filter changes the id). */
export function rowHasApplicationId(a: Pick<EmployerApplicant, 'id' | 'applications'>, id: string): boolean {
  return a.id === id || Boolean(a.applications?.some((x) => x.applicationId === id))
}

/**
 * Apply a change made on one application (e.g. Shortlist) to the loaded rows. The id may be the row's own
 * application or another job's application of the same person (a row shown under that job's filter).
 */
export function patchApplicantRows(
  rows: EmployerApplicant[],
  id: string,
  patch: Partial<EmployerApplicant>,
): EmployerApplicant[] {
  const patchApps = (apps: EmployerApplicantApplication[] | undefined) =>
    apps && patch.status
      ? apps.map((x) => (x.applicationId === id ? { ...x, status: patch.status } : x))
      : apps
  return rows.map((a) => {
    if (a.id === id) return { ...a, ...patch, ...(a.applications ? { applications: patchApps(a.applications) } : {}) }
    if (a.applications?.some((x) => x.applicationId === id)) return { ...a, applications: patchApps(a.applications) }
    return a
  })
}
