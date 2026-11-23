import type { EmployerApplicant } from './store'
import { candidateScore } from './candidateSearch'
import { jobIdsOf } from './applicantSearch'
import { projectApplicantToJobs } from '../components/applicants/applicantJobs'

/** The four numbers shown in the stat tiles (talent vault, and one job's applications page). */
export type ApplicantStats = {
  total: number
  parsed: number
  interviewed: number
  /** Rounded mean interview score of the interviewed applicants; null when nobody has been interviewed. */
  averageScore: number | null
}

export function completionRate(stats: Pick<ApplicantStats, 'total' | 'interviewed'>): number {
  return stats.total ? Math.round((stats.interviewed / stats.total) * 100) : 0
}

/**
 * Stats for the people who applied to one job. Someone who applied to several jobs counts once here, and only an
 * interview taken for THIS job counts as interviewed (a score from another job's interview does not).
 */
export function jobApplicantStats(applicants: readonly EmployerApplicant[], jobId: string): ApplicantStats {
  const rows = applicants
    .filter((a) => jobIdsOf(a).includes(jobId))
    .map((a) => projectApplicantToJobs(a, [jobId]))
  const scores: number[] = []
  let parsed = 0
  for (const a of rows) {
    if ((a.resumeText ?? '').trim()) parsed += 1
    const score = candidateScore(a)
    const otherJobInterview =
      a.interviewSource === 'general' || Boolean(a.interviewJobId && a.interviewJobId !== jobId)
    if (score !== null && !otherJobInterview) scores.push(score)
  }
  return {
    total: rows.length,
    parsed,
    interviewed: scores.length,
    averageScore: scores.length ? Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length) : null,
  }
}
