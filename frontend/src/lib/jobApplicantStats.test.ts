import { describe, expect, it } from 'vitest'
import type { EmployerApplicant } from './store'
import { completionRate, jobApplicantStats } from './jobApplicantStats'

const base = (over: Partial<EmployerApplicant>): EmployerApplicant =>
  ({ id: 'x', jobId: 'job-a', candidateName: 'A', resumeText: 'Resume text', ...over }) as EmployerApplicant

describe('jobApplicantStats', () => {
  it('counts only applicants of the given job', () => {
    const rows = [
      base({ id: '1', jobId: 'job-a', aiScore: 80 }),
      base({ id: '2', jobId: 'job-a', resumeText: '' }),
      base({ id: '3', jobId: 'job-b', aiScore: 40 }),
    ]
    expect(jobApplicantStats(rows, 'job-a')).toEqual({ total: 2, parsed: 1, interviewed: 1, averageScore: 80 })
  })

  it('averages and rounds the interview scores', () => {
    const rows = [base({ id: '1', aiScore: 18 }), base({ id: '2', aiScore: 19 }), base({ id: '3' })]
    const stats = jobApplicantStats(rows, 'job-a')
    expect(stats.interviewed).toBe(2)
    expect(stats.averageScore).toBe(19)
    expect(completionRate(stats)).toBe(67)
  })

  it('does not count an interview taken for another job', () => {
    const twoJobs = base({
      id: 'app-a',
      jobId: 'job-a',
      appliedJobIds: ['job-a', 'job-b'],
      aiScore: 90,
      interviewJobId: 'job-a',
      applications: [
        { applicationId: 'app-a', jobId: 'job-a', jobTitle: 'A' },
        { applicationId: 'app-b', jobId: 'job-b', jobTitle: 'B' },
      ],
    } as Partial<EmployerApplicant>)
    expect(jobApplicantStats([twoJobs], 'job-a')).toMatchObject({ total: 1, interviewed: 1, averageScore: 90 })
    expect(jobApplicantStats([twoJobs], 'job-b')).toMatchObject({ total: 1, interviewed: 0, averageScore: null })
  })

  it('is empty for a job with no applicants', () => {
    expect(jobApplicantStats([], 'job-a')).toEqual({ total: 0, parsed: 0, interviewed: 0, averageScore: null })
    expect(completionRate({ total: 0, interviewed: 0 })).toBe(0)
  })
})
