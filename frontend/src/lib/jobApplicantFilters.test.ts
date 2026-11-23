import { describe, expect, it } from 'vitest'
import type { EmployerApplicant } from './store'
import {
  DEFAULT_JOB_APPLICANT_FILTERS as D,
  filterJobApplicants,
  interviewScoreOf,
  summarizeJobApplicants,
} from './jobApplicantFilters'

function app(over: Partial<EmployerApplicant>): EmployerApplicant {
  return {
    id: over.id || Math.random().toString(36),
    jobId: 'j1',
    jobTitle: 'Backend Engineer',
    company: 'Acme',
    candidateName: 'Someone',
    candidateEmail: 'x@example.com',
    candidatePhone: '',
    experienceYears: '',
    resumeName: null,
    appliedAt: '2026-11-01T00:00:00Z',
    status: 'New',
    ...over,
  }
}

const rows = [
  app({ id: 'a', candidateName: 'Asha', atsScore: 82, jdMatchScore: 70, aiScore: 64, source: 'job_board', matchedSkills: ['Python'], appliedAt: '2026-11-03T00:00:00Z' }),
  app({ id: 'b', candidateName: 'Ben', atsScore: 55, jdMatchScore: 90, source: 'shared_link', appliedAt: '2026-11-05T00:00:00Z' }),
  app({ id: 'c', candidateName: 'Chen', atsScore: 91, jdMatchScore: 60, aiScore: 88, source: 'shared_link', status: 'Shortlisted', appliedAt: '2026-11-02T00:00:00Z' }),
]

describe('job applicant filters', () => {
  it('sorts by top candidature by default and by ATS score on request', () => {
    expect(D.sort).toBe('rank')
    expect(filterJobApplicants(rows, D).map((r) => r.id)).toEqual(['c', 'a', 'b'])
    expect(filterJobApplicants(rows, { ...D, sort: 'ats' }).map((r) => r.id)).toEqual(['c', 'a', 'b'])
  })

  it('keeps the API ranking: score, then role skills fit, then who finished first', () => {
    const ranked = [
      app({ id: 'late', aiScore: 70, roleSkillsFit: 60, interviewCompletedAt: '2026-11-02T10:00:00Z', rank: 3 }),
      app({ id: 'none', appliedAt: '2026-10-01T00:00:00Z', rank: null }),
      app({ id: 'top', aiScore: 82, roleSkillsFit: 50, rank: 1 }),
      app({ id: 'fit', aiScore: 70, roleSkillsFit: 80, rank: 2 }),
    ]
    expect(filterJobApplicants(ranked, D).map((r) => r.id)).toEqual(['top', 'fit', 'late', 'none'])
    // Rows from an older API without `rank` are ordered by the same rule.
    const unranked = ranked.map((r) => ({ ...r, rank: undefined }))
    expect(filterJobApplicants(unranked, D).map((r) => r.id)).toEqual(['top', 'fit', 'late', 'none'])
    const tie = [
      app({ id: 'second', aiScore: 70, roleSkillsFit: 60, interviewCompletedAt: '2026-11-02T10:00:00Z' }),
      app({ id: 'first', aiScore: 70, roleSkillsFit: 60, interviewCompletedAt: '2026-11-02T09:00:00Z' }),
    ]
    expect(filterJobApplicants(tie, D).map((r) => r.id)).toEqual(['first', 'second'])
  })

  it('sorts by JD match, interview score and newest', () => {
    expect(filterJobApplicants(rows, { ...D, sort: 'jd' }).map((r) => r.id)).toEqual(['b', 'a', 'c'])
    expect(filterJobApplicants(rows, { ...D, sort: 'interview' }).map((r) => r.id)).toEqual(['c', 'a', 'b'])
    expect(filterJobApplicants(rows, { ...D, sort: 'newest' }).map((r) => r.id)).toEqual(['b', 'a', 'c'])
  })

  it('filters by minimum ATS score', () => {
    expect(filterJobApplicants(rows, { ...D, minAts: 80 }).map((r) => r.id)).toEqual(['c', 'a'])
  })

  it('filters by interview state and minimum HireRighttt score', () => {
    expect(filterJobApplicants(rows, { ...D, interview: 'not_interviewed' }).map((r) => r.id)).toEqual(['b'])
    expect(filterJobApplicants(rows, { ...D, interview: 'interviewed' }).map((r) => r.id)).toEqual(['c', 'a'])
    expect(filterJobApplicants(rows, { ...D, interview: 70 }).map((r) => r.id)).toEqual(['c'])
  })

  it('filters by source and status', () => {
    expect(filterJobApplicants(rows, { ...D, source: 'shared_link' }).map((r) => r.id)).toEqual(['c', 'b'])
    expect(filterJobApplicants(rows, { ...D, status: 'Shortlisted' }).map((r) => r.id)).toEqual(['c'])
  })

  it('searches names and matched skills', () => {
    expect(filterJobApplicants(rows, { ...D, query: 'python' }).map((r) => r.id)).toEqual(['a'])
    expect(filterJobApplicants(rows, { ...D, query: 'ben' }).map((r) => r.id)).toEqual(['b'])
  })

  it('reads the interview score from the report when aiScore is missing', () => {
    expect(interviewScoreOf(app({ interviewResult: { overall: 77 } as EmployerApplicant['interviewResult'] }))).toBe(77)
    expect(interviewScoreOf(app({}))).toBeNull()
  })

  it('summarizes counts and averages', () => {
    expect(summarizeJobApplicants(rows)).toEqual({ total: 3, interviewed: 2, avgAts: 76, avgInterview: 76 })
  })
})
