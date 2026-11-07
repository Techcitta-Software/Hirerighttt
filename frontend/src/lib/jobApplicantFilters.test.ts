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
  it('sorts by ATS score by default', () => {
    expect(filterJobApplicants(rows, D).map((r) => r.id)).toEqual(['c', 'a', 'b'])
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
