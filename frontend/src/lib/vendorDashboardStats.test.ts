import { describe, expect, it } from 'vitest'
import type { EmployerApplicant } from './store'
import { vendorDashboardStats } from './vendorDashboardStats'

const NOW = Date.parse('2026-11-24T00:00:00Z')

describe('vendorDashboardStats', () => {
  it('counts a person who applied to two openings on both (matches the Jobs list)', () => {
    const jobs = [
      { id: 'be', title: 'Backend', status: 'published' },
      { id: 'fe', title: 'Frontend', status: 'closed' },
      { id: 'qa', title: 'QA', status: 'published' },
      { id: 'ux', title: 'Design', status: 'active' },
      { id: 'dr', title: 'Intern', status: 'draft' },
      { id: 'arc', title: 'Old role', status: 'archived' },
    ]
    const people = [
      { id: '1', jobId: 'fe', appliedJobIds: ['fe', 'be'], status: 'New', appliedAt: '2026-11-22T00:00:00Z' },
      { id: '2', jobId: 'be', status: 'Shortlisted', appliedAt: '2026-11-01T00:00:00Z' },
    ] as EmployerApplicant[]
    const s = vendorDashboardStats(jobs, people, NOW)
    expect(s.perJob.find((j) => j.id === 'be')?.count).toBe(2)
    expect(s.perJob.find((j) => j.id === 'fe')?.count).toBe(1)
    // Published Backend and QA, plus legacy "active" Design (no applicants). Closed Frontend has an applicant and is not active.
    expect(s.activeJobs).toBe(3)
    expect(s.jobsWithoutApplicants).toBe(4)
    expect(s.totalCandidates).toBe(2)
    expect(s.newThisWeek).toBe(1)
  })
})
