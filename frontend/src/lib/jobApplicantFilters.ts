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
  /** 'rank' = top candidature (the API's ranking): interview score, then Role Skills Fit, then who finished first. */
  sort: 'rank' | 'ats' | 'jd' | 'interview' | 'newest'
}

export const DEFAULT_JOB_APPLICANT_FILTERS: JobApplicantFilters = {
  query: '',
  minAts: 0,
  interview: 'any',
  source: 'all',
  status: 'all',
  sort: 'rank',
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

/** Role Skills Fit the ranking uses: the API's value, else the report's own analysis. */
export function roleSkillsFitOf(a: EmployerApplicant): number | null {
  if (typeof a.roleSkillsFit === 'number') return a.roleSkillsFit
  const analysis = a.interviewResult?.roleSkillsAnalysis
  if (analysis?.requiredSkills?.length && typeof analysis.fitScore === 'number') return analysis.fitScore
  const fit = a.interviewResult?.resumeFitScore
  return typeof fit === 'number' ? fit : null
}

/**
 * Top candidature order. The API ranks the list (`rank`, 1 = best) and that order is used as is; rows without
 * a rank (not interviewed) follow, compared by the same rule as the API: interview score, Role Skills Fit,
 * earliest interview completion, earliest application.
 */
export function compareTopCandidature(x: EmployerApplicant, y: EmployerApplicant): number {
  const rx = typeof x.rank === 'number' ? x.rank : null
  const ry = typeof y.rank === 'number' ? y.rank : null
  if (rx !== null && ry !== null) return rx - ry
  const sx = interviewScoreOf(x)
  const sy = interviewScoreOf(y)
  if ((sx === null) !== (sy === null)) return sx === null ? 1 : -1
  const iso = (v: string | null | undefined) => v || '9999'
  return (
    num(sy) - num(sx) ||
    num(roleSkillsFitOf(y)) - num(roleSkillsFitOf(x)) ||
    iso(x.interviewCompletedAt).localeCompare(iso(y.interviewCompletedAt)) ||
    iso(x.appliedAt).localeCompare(iso(y.appliedAt))
  )
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
  if (f.sort === 'rank') return [...out].sort(compareTopCandidature)
  const by: Record<Exclude<JobApplicantFilters['sort'], 'rank'>, (a: EmployerApplicant) => number> = {
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
