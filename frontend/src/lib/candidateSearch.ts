/**
 * Recruiter candidate search: multi-word, order-independent, ranked by where the words matched.
 *
 * Every word the recruiter types must be found somewhere on the candidate (so "react bengaluru" narrows the list),
 * and candidates are ordered by how strong the matches are (name and email beat role, role beats resume text, and
 * more mentions in the resume rank higher).
 *
 * Note: an application's `primarySkills` are the JOB's skills (extracted from the job description), not the
 * candidate's, so they are deliberately not searched: every applicant to a React job would match "react".
 */
import type { EmployerApplicant } from './store'

export type SearchableCandidate = Pick<
  EmployerApplicant,
  | 'candidateName'
  | 'candidateEmail'
  | 'candidatePhone'
  | 'role'
  | 'jobTitle'
  | 'company'
  | 'experienceYears'
  | 'resumeText'
  | 'status'
>

const WEIGHTS = {
  name: 10,
  email: 8,
  phone: 8,
  role: 6,
  job: 5,
  experience: 3,
  status: 2,
  resume: 1,
} as const

const norm = (value: unknown): string => String(value ?? '').toLowerCase()
const digits = (value: unknown): string => String(value ?? '').replace(/\D/g, '')

export function tokenizeQuery(query: string): string[] {
  return Array.from(new Set(norm(query).split(/[\s,;]+/).filter(Boolean)))
}

/** Returns 0 when the candidate does not match every word, otherwise a positive relevance score. */
export function candidateMatchScore(candidate: SearchableCandidate, query: string): number {
  const tokens = tokenizeQuery(query)
  if (!tokens.length) return 1

  const fields = {
    name: norm(candidate.candidateName),
    email: norm(candidate.candidateEmail),
    phone: norm(candidate.candidatePhone),
    phoneDigits: digits(candidate.candidatePhone),
    role: norm(candidate.role),
    job: `${norm(candidate.jobTitle)} ${norm(candidate.company)}`,
    experience: norm(candidate.experienceYears),
    status: norm(candidate.status),
    resume: norm(candidate.resumeText),
  }

  let total = 0
  for (const token of tokens) {
    let best = 0
    const numeric = digits(token)
    if (fields.name.includes(token)) best = Math.max(best, WEIGHTS.name + (fields.name.startsWith(token) ? 3 : 0))
    if (fields.email.includes(token)) best = Math.max(best, WEIGHTS.email)
    if (fields.phone.includes(token) || (numeric.length >= 4 && fields.phoneDigits.includes(numeric))) {
      best = Math.max(best, WEIGHTS.phone)
    }
    if (fields.role.includes(token)) best = Math.max(best, WEIGHTS.role)
    if (fields.job.includes(token)) best = Math.max(best, WEIGHTS.job)
    if (fields.experience.includes(token)) best = Math.max(best, WEIGHTS.experience)
    if (fields.status.includes(token)) best = Math.max(best, WEIGHTS.status)
    if (fields.resume.includes(token)) {
      // Free resume text: more mentions = stronger match (capped), so a real React developer outranks a passing mention.
      const hits = fields.resume.split(token).length - 1
      best = Math.max(best, WEIGHTS.resume + Math.min(3, hits - 1))
    }
    if (best === 0) return 0 // every word must match somewhere
    total += best
  }
  return total
}

export type CandidateQuickFilter = 'all' | 'interviewed' | 'not_interviewed' | 'score_70' | 'review'
export type CandidateSort = 'best_match' | 'newest' | 'score' | 'name'

type FilterableCandidate = SearchableCandidate &
  Pick<EmployerApplicant, 'appliedAt' | 'aiScore' | 'interviewResult' | 'integrityStatus'>

export function candidateScore(c: Pick<EmployerApplicant, 'aiScore' | 'interviewResult'>): number | null {
  const value = c.aiScore ?? c.interviewResult?.overall
  return typeof value === 'number' ? value : null
}

export function needsIntegrityReview(c: Pick<EmployerApplicant, 'integrityStatus' | 'interviewResult'>): boolean {
  if (c.integrityStatus === 'pending' || c.integrityStatus === 'unverified') return true
  const integrity = c.interviewResult?.integrity
  return Boolean(integrity?.proctoring?.status === 'FLAGGED' || (integrity?.faceViolations ?? 0) > 0)
}

export function matchesQuickFilter(c: FilterableCandidate, filter: CandidateQuickFilter): boolean {
  const score = candidateScore(c)
  switch (filter) {
    case 'interviewed':
      return Boolean(c.interviewResult)
    case 'not_interviewed':
      return !c.interviewResult
    case 'score_70':
      return score !== null && score >= 70
    case 'review':
      return needsIntegrityReview(c)
    default:
      return true
  }
}

export function searchCandidates<T extends FilterableCandidate>(
  candidates: T[],
  options: { query: string; quick: CandidateQuickFilter; sort: CandidateSort },
): T[] {
  const hasQuery = tokenizeQuery(options.query).length > 0
  const scored = candidates
    .filter((c) => matchesQuickFilter(c, options.quick))
    .map((c) => ({ c, match: candidateMatchScore(c, options.query) }))
    .filter((x) => x.match > 0)

  const byDate = (a: T, b: T) => String(b.appliedAt).localeCompare(String(a.appliedAt))
  scored.sort((a, b) => {
    switch (options.sort) {
      case 'score':
        return (candidateScore(b.c) ?? -1) - (candidateScore(a.c) ?? -1) || byDate(a.c, b.c)
      case 'name':
        return a.c.candidateName.localeCompare(b.c.candidateName)
      case 'newest':
        return byDate(a.c, b.c)
      default: // best_match: most relevant first when searching, otherwise newest first
        return hasQuery ? b.match - a.match || byDate(a.c, b.c) : byDate(a.c, b.c)
    }
  })
  return scored.map((x) => x.c)
}

/** Splits text into highlighted / plain segments for the words the recruiter searched. */
export function highlightSegments(text: string, query: string): { text: string; match: boolean }[] {
  const tokens = tokenizeQuery(query).filter((t) => t.length > 0)
  if (!text || !tokens.length) return [{ text, match: false }]
  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length)
  const pattern = escaped.join('|')
  const splitter = new RegExp(`(${pattern})`, 'gi')
  const exact = new RegExp(`^(?:${pattern})$`, 'i')
  return text
    .split(splitter)
    .filter((part) => part !== '')
    .map((part) => ({ text: part, match: exact.test(part) }))
}
