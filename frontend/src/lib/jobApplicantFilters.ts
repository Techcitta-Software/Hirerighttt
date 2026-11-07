import type { EmployerApplicant } from './store'

/** How the vendor narrows and orders the applicants of one job. */
export type JobApplicantFilters = {
  query: string
  /** Minimum resume-vs-JD ATS score (0 = any). */
  minAts: number
  /** 'any' | 'interviewed' | 'not_interviewed' | a minimum HireRighttt interview score. */
  interview: 'any' | 'interviewed' | 'not_interviewed' | number
  source: 'all' | 'job_board' | 'shared_link' | 'invite'
  status: 'all' | EmployerApplicant['status']
  sort: 'ats' | 'jd' | 'interview' | 'newest'
}

export const DEFAULT_JOB_APPLICANT_FILTERS: JobApplicantFilters = {
  query: '',
  minAts: 0,
  interview: 'any',
  source: 'all',
  status: 'all',
  sort: 'ats',
}

/** HireRighttt interview score (0–100) when the candidate has interviewed. */
export function interviewScoreOf(a: EmployerApplicant): number | null {
  if (typeof a.aiScore === 'number') return a.aiScore
  const overall = a.interviewResult?.overall
  return typeof overall === 'number' ? overall : null
}

function num(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : -1
}

export function filterJobApplicants(rows: EmployerApplicant[], f: JobApplicantFilters): EmployerApplicant[] {
  const words = f.query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const out = rows.filter((a) => {
    if (words.length) {
      const hay = [a.candidateName, a.candidateEmail, a.candidatePhone, a.role, ...(a.matchedSkills || []), ...(a.primarySkills || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!words.every((w) => hay.includes(w))) return false
    }
    if (f.minAts > 0 && num(a.atsScore) < f.minAts) return false
    const score = interviewScoreOf(a)
    if (f.interview === 'interviewed' && score === null) return false
    if (f.interview === 'not_interviewed' && score !== null) return false
    if (typeof f.interview === 'number' && (score === null || score < f.interview)) return false
    if (f.source !== 'all' && a.source !== f.source) return false
    if (f.status !== 'all' && a.status !== f.status) return false
    return true
  })
  const by: Record<JobApplicantFilters['sort'], (a: EmployerApplicant) => number> = {
    ats: (a) => num(a.atsScore),
    jd: (a) => num(a.jdMatchScore),
    interview: (a) => num(interviewScoreOf(a)),
    newest: (a) => new Date(a.appliedAt || 0).getTime() || 0,
  }
  const key = by[f.sort]
  return [...out].sort((x, y) => key(y) - key(x) || num(y.atsScore) - num(x.atsScore))
}

export type JobApplicantSummary = { total: number; interviewed: number; avgAts: number | null; avgInterview: number | null }

export function summarizeJobApplicants(rows: EmployerApplicant[]): JobApplicantSummary {
  const ats = rows.map((r) => r.atsScore).filter((v): v is number => typeof v === 'number')
  const iv = rows.map(interviewScoreOf).filter((v): v is number => v !== null)
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, v) => s + v, 0) / xs.length) : null)
  return { total: rows.length, interviewed: iv.length, avgAts: avg(ats), avgInterview: avg(iv) }
}
