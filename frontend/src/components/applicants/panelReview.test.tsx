import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applicantsToCsv, indexApplicant } from '../../lib/applicantSearch'
import { experienceText, resumeTextFileName } from '../../lib/employerCandidateUtils'
import { formatPhoneForDisplay, phoneTelHref } from '../../lib/phone'
import type { EmployerApplicant } from '../../lib/store'
import { loadRecordingAndReview } from '../../lib/interviewReviewLoad'
import { ApplicantsSearch } from './ApplicantsSearch'

const NOW = Date.parse('2026-11-20T12:00:00Z')

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

function app(over: Partial<EmployerApplicant>): EmployerApplicant {
  return {
    id: 'kav',
    jobId: 'job-fe',
    jobTitle: 'Frontend Engineer',
    company: 'Acme',
    candidateName: 'Kavya Iyer',
    candidateEmail: 'kavya@example.com',
    candidatePhone: '919888000007',
    experienceYears: '4 years',
    resumeName: 'Kavya_Iyer_Resume.pdf',
    resumeText: 'SKILLS\nReact, TypeScript',
    appliedAt: new Date(NOW - 86_400_000).toISOString(),
    status: 'New',
    recordSource: 'application',
    ...over,
  }
}

function render(url: string, applicants: EmployerApplicant[]) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [url] },
      createElement(ApplicantsSearch, {
        mode: 'applications',
        applicants,
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

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Phone numbers on the employer side', () => {
  it('formats stored digits as +91 98880 00007 and links tel:+91…', () => {
    expect(formatPhoneForDisplay('919888000007')).toBe('+91 98880 00007')
    expect(formatPhoneForDisplay('+91 98880 00007')).toBe('+91 98880 00007')
    expect(phoneTelHref('919888000007')).toBe('tel:+919888000007')
    expect(phoneTelHref('+91 98880 00007')).toBe('tel:+919888000007')
    expect(phoneTelHref('+44 20 7946 0958')).toBe('tel:+442079460958')
    expect(phoneTelHref('')).toBe('')
  })

  it('shows the formatted phone in the drawer (Profile contact and header), with copy buttons', () => {
    const html = render('/employer/applicants?applicant=kav', [app({})])
    expect(html).not.toContain('919888000007<')
    expect(html).toContain('href="tel:+919888000007"')
    expect(html.match(/>\+91 98880 00007</g)?.length).toBe(2)
    expect(html).toContain('data-testid="panel-contact"')
    expect(html).toContain('aria-label="Copy email"')
    expect(html).toContain('aria-label="Copy phone number"')
  })

  it('writes the formatted phone to the CSV export', () => {
    const csv = applicantsToCsv([indexApplicant(app({}))])
    expect(csv).toContain("'+91 98880 00007")
    expect(csv).not.toContain(',919888000007')
  })
})

describe('Drawer states', () => {
  it('Interview report with no interview: an empty state with the invite action', () => {
    const html = render('/employer/applicants?applicant=kav&tab=report', [app({})])
    expect(html).toContain('data-testid="report-empty"')
    expect(html).toContain('No interview yet')
    expect(html).toMatch(/report-empty[\s\S]*Invite to interview/)
  })

  it('Interview report summary uses the Profile score card, with the full-report action in its footer', () => {
    const html = render('/employer/applicants?applicant=kav&tab=report', [
      app({ aiScore: 71, interviewResult: { overall: 71, categories: [], answers: [], strengths: [], improvements: [] } as never }),
    ])
    expect(html).toMatch(/id="applicant-tabpanel-report"[\s\S]*aria-label="Interview summary"/)
    expect(html).toContain('Open the full report and recording')
  })

  it('names a resume-text download .txt, never a .pdf that will not open', () => {
    expect(resumeTextFileName({ resumeName: 'Kavya_Iyer_Resume.pdf', candidateName: 'Kavya Iyer' })).toBe('Kavya_Iyer_Resume.txt')
    expect(resumeTextFileName({ resumeName: null, candidateName: 'Kavya Iyer' })).toBe('Kavya_Iyer_resume.txt')
  })
})

describe('Signal column on the list rows', () => {
  const twoJobs = app({
    id: 'rah',
    candidateName: 'Rahul Verma',
    aiScore: 14,
    rank: 3,
    interviewResult: { overall: 14 } as never,
    interviewJobId: 'job-fe',
    applications: [
      { applicationId: 'rah', jobId: 'job-fe', jobTitle: 'Frontend Engineer' },
      { applicationId: 'rah-be', jobId: 'job-be', jobTitle: 'Backend Engineer' },
    ] as never,
  })

  it('on the job the interview was for, the job is implied: no note beside the score or the rank', () => {
    const html = render('/employer/applicants?jobId=job-fe', [twoJobs])
    expect(html).not.toContain('Interview taken for Frontend Engineer')
    expect(html).not.toContain('Rank for Frontend Engineer')
  })

  it('on another job, the score names its job on its own line (icon + job, full name in the tooltip)', () => {
    const html = render('/employer/applicants?jobId=job-be', [{ ...twoJobs, id: 'rah-be', jobId: 'job-be', jobTitle: 'Backend Engineer' }])
    expect(html).toMatch(/class="[^"]*sigNote[^"]*" title="Interview taken for Frontend Engineer"><svg/)
    expect(html).not.toContain('Frontend Engineer interview')
  })
})

describe('Open the full report: the interview review 404s', () => {
  it('settles both requests without an unhandled rejection and returns no review', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const notFound = () => Promise.reject(new Error('Interview not found for this candidate.'))
      const slowRecording = () =>
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('No recording')), 20))
      const out = await loadRecordingAndReview('kavya@example.com', 'qa-session', {
        recording: slowRecording,
        review: notFound,
      })
      await new Promise((r) => setTimeout(r, 10))
      expect(out).toEqual({ rec: null, review: null })
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('uses the recording session for the review when the result has none', async () => {
    const review = vi.fn(async () => ({ events: [], videoUrl: null, recordingStatus: 'x' }))
    const out = await loadRecordingAndReview('k@example.com', null, {
      recording: async () => ({ sessionId: 's-1', viewUrl: 'v', downloadUrl: 'd', expiresInSeconds: 60 }) as never,
      review,
    })
    expect(review).toHaveBeenCalledWith('s-1', 'k@example.com')
    expect(out.review).toEqual({ events: [], videoUrl: null, recordingStatus: 'x' })
  })
})

describe('report header experience', () => {
  it('words a bare number of years and keeps worded values', () => {
    expect(experienceText('6')).toBe('6 yrs')
    expect(experienceText('1')).toBe('1 yr')
    expect(experienceText('4 years')).toBe('4 years')
    expect(experienceText(undefined)).toBe('')
  })
})
