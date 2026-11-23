import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmployerApplicant } from '../../lib/store'
import { mapOrgCandidate } from '../../lib/employerCandidateUtils'
import { ApplicantsSearch } from './ApplicantsSearch'
import {
  appliedJobsLabel,
  patchApplicantRows,
  projectApplicantToJobs,
  rowHasApplicationId,
  scoreJobTitle,
} from './applicantJobs'

const NOW = Date.parse('2026-11-20T12:00:00Z')

/** One person, two jobs: interviewed for Frontend (82), shortlisted on Backend without an interview of its own. */
const TWO_JOBS: EmployerApplicant = {
  id: 'app-fe',
  jobId: 'job-fe',
  jobTitle: 'Frontend Engineer',
  company: 'Acme',
  candidateName: 'Rahul Mehta',
  candidateEmail: 'rahul@example.com',
  candidatePhone: '',
  experienceYears: '4 years',
  resumeName: 'cv.pdf',
  resumeText: 'SKILLS\nReact, TypeScript, Python',
  appliedAt: '2026-11-10T10:00:00Z',
  status: 'In Review',
  recordSource: 'application',
  interviewResult: { overall: 82 } as EmployerApplicant['interviewResult'],
  aiScore: 82,
  atsScore: 71,
  jdMatchScore: 64,
  appliedJobIds: ['job-fe', 'job-be'],
  interviewJobId: 'job-fe',
  applications: [
    { applicationId: 'app-fe', jobId: 'job-fe', jobTitle: 'Frontend Engineer', status: 'In Review', atsScore: 71, jdMatchScore: 64, interviewed: true, interviewScore: 82, appliedAt: '2026-11-10T10:00:00Z' },
    { applicationId: 'app-be', jobId: 'job-be', jobTitle: 'Backend Engineer', status: 'Shortlisted', atsScore: 40, jdMatchScore: 35, interviewed: false, interviewScore: null, appliedAt: '2026-11-12T10:00:00Z' },
  ],
}

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    get length() {
      return data.size
    },
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
})

describe('two-job applicant', () => {
  it('under the other job shows that application: id, title, status and ATS scores', () => {
    const be = projectApplicantToJobs({ ...TWO_JOBS, rank: 1 }, ['job-be'])
    expect(be.id).toBe('app-be')
    expect(be.jobId).toBe('job-be')
    expect(be.jobTitle).toBe('Backend Engineer')
    expect(be.status).toBe('Shortlisted')
    expect(be.atsScore).toBe(40)
    expect(be.jdMatchScore).toBe(35)
    expect(be.rank).toBeUndefined() // the Frontend rank is not carried over; Backend's comes from its own ranking
    expect(be.interviewSource).toBe('general')
    expect(scoreJobTitle(be)).toBe('Frontend Engineer') // the score says where it came from
  })

  it('is unchanged without a filter, under its own job, or for a job it did not apply to', () => {
    expect(projectApplicantToJobs(TWO_JOBS, [])).toBe(TWO_JOBS)
    expect(projectApplicantToJobs(TWO_JOBS, ['job-fe'])).toBe(TWO_JOBS)
    expect(projectApplicantToJobs(TWO_JOBS, ['job-zz'])).toBe(TWO_JOBS)
  })

  it('lists every job applied to and attributes the score', () => {
    expect(appliedJobsLabel(TWO_JOBS)).toBe('Applied to: Frontend Engineer, Backend Engineer')
    expect(appliedJobsLabel({ jobTitle: 'Solo', applications: undefined })).toBe('Applied to: Solo')
    expect(appliedJobsLabel({ jobTitle: '', applications: undefined })).toBe('')
    expect(scoreJobTitle(TWO_JOBS)).toBe('Frontend Engineer')
    expect(scoreJobTitle({ ...TWO_JOBS, applications: TWO_JOBS.applications!.slice(0, 1) })).toBe('')
  })

  it('finds the row by either application id and patches the right application', () => {
    expect(rowHasApplicationId(TWO_JOBS, 'app-be')).toBe(true)
    expect(rowHasApplicationId(TWO_JOBS, 'nope')).toBe(false)
    const [row] = patchApplicantRows([TWO_JOBS], 'app-be', { status: 'Rejected' })
    expect(row.status).toBe('In Review') // the Frontend application is untouched
    expect(row.applications!.find((x) => x.applicationId === 'app-be')!.status).toBe('Rejected')
    const [own] = patchApplicantRows([TWO_JOBS], 'app-fe', { status: 'Shortlisted' })
    expect(own.status).toBe('Shortlisted')
    expect(own.applications!.find((x) => x.applicationId === 'app-fe')!.status).toBe('Shortlisted')
  })

  it('maps the API fields', () => {
    const mapped = mapOrgCandidate({
      id: 'app-fe',
      source: 'application',
      jobId: 'job-fe',
      candidateEmail: 'rahul@example.com',
      candidateName: 'Rahul',
      appliedAt: '2026-11-10T10:00:00Z',
      applications: TWO_JOBS.applications,
      interviewJobId: 'job-fe',
    } as Parameters<typeof mapOrgCandidate>[0])
    expect(mapped.applications).toHaveLength(2)
    expect(mapped.interviewJobId).toBe('job-fe')
  })

  function render(url: string) {
    return renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: [url] },
        createElement(ApplicantsSearch, {
          mode: 'applications',
          applicants: [TWO_JOBS],
          jobs: [
            { id: 'job-fe', title: 'Frontend Engineer' },
            { id: 'job-be', title: 'Backend Engineer' },
          ],
          loading: false,
          onRetry: () => {},
          loadRanking: false,
          now: NOW,
        }),
      ),
    )
  }

  it('renders all jobs unfiltered and the Backend application under the Backend filter', () => {
    const all = render('/employer/applicants')
    expect(all).toContain('Applied to: Frontend Engineer, Backend Engineer')
    expect(all).toContain('Frontend Engineer interview')
    expect(all).toContain('id="tuple-name-app-fe"')

    const be = render('/employer/applicants?jobId=job-be')
    expect(be).toContain('id="tuple-name-app-be"')
    expect(be).toContain('>Shortlisted<')
    expect(be).toContain('Frontend Engineer interview')
  })
})
