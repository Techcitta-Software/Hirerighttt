import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmployerApplicant } from '../../lib/store'
import { AppFooter } from '../AppFooter'
import { ApplicantsSearch, type ApplicantsSearchProps } from './ApplicantsSearch'

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
    id: 'a',
    jobId: 'job-fe',
    jobTitle: 'Frontend Engineer',
    company: 'Acme',
    candidateName: 'Someone',
    candidateEmail: 'someone@example.com',
    candidatePhone: '+91 90000 00000',
    experienceYears: '3 years',
    resumeName: 'cv.pdf',
    resumeText: 'SKILLS\nReact, TypeScript',
    appliedAt: new Date(NOW - 86_400_000).toISOString(),
    status: 'New',
    recordSource: 'application',
    ...over,
  }
}

const ROWS: EmployerApplicant[] = [
  app({ id: 'ana', candidateName: 'Ananya Rao', role: 'Frontend Developer', experienceYears: '6 years', candidateEmail: 'ananya@example.com', aiScore: 86 }),
  app({ id: 'vik', jobId: 'job-be', jobTitle: 'Backend Engineer', candidateName: 'Vikram Shah', role: 'Backend Developer', experienceYears: '2', candidateEmail: 'vikram@example.com', resumeText: 'SKILLS\nPython, FastAPI', aiScore: 81 }),
  app({ id: 'hid', jobId: '', jobTitle: '', recordSource: 'talent', candidateName: 'Hidden Person', candidateEmail: '', candidatePhone: '', contactHidden: true, resumeText: 'SKILLS\nGo' }),
]

function render(url = '/employer/applicants', props: Partial<ApplicantsSearchProps> = {}) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [url] },
      createElement(ApplicantsSearch, {
        mode: 'applications',
        applicants: ROWS,
        jobs: [
          { id: 'job-fe', title: 'Frontend Engineer' },
          { id: 'job-be', title: 'Backend Engineer' },
        ],
        loading: false,
        onRetry: () => {},
        loadRanking: false,
        now: NOW,
        ...props,
      }),
    ),
  )
}

const names = (html: string) => Array.from(html.matchAll(/id="tuple-name-([^"]+)"/g), (m) => m[1])

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
})

describe('Applicants page', () => {
  it('lists applicants as articles with score, count and no contact details on the rows', () => {
    const html = render()
    expect(names(html)).toEqual(['ana', 'vik', 'hid'])
    expect(html).toContain('Showing 1–3 of 3 applicants')
    expect(html).toContain('86<span')
    expect(html).toContain('Not interviewed')
    expect(html).not.toContain('ananya@example.com')
    expect(html).not.toContain('+91 90000 00000')
    expect(html).toMatch(/<li><article[^>]+aria-labelledby="tuple-name-ana"/)
  })

  it('applies the job and keywords from the URL and ignores hidden filters', () => {
    const byJob = render('/employer/applicants?jobId=job-fe')
    expect(names(byJob)).toEqual(['ana'])

    const kw = render('/employer/applicants?q=typescript')
    expect(names(kw)).toEqual(['ana'])
    expect(kw).toContain('<mark')

    // A skill param would hide Ananya; it must not, or the job view would filter with no control for it.
    expect(names(render('/employer/applicants?jobId=job-fe&skill=Python'))).toEqual(['ana'])
    expect(names(render('/employer/applicants?score=80%2B'))).toEqual(['ana', 'vik', 'hid'])
  })

  it('does not show the filter rail, its sheet, or filter actions', () => {
    const html = render()
    expect(html).not.toContain('id="applicant-filters"')
    expect(html).not.toContain('aria-controls="applicant-filters"')
    expect(html).not.toContain('Current role')
    expect(html).not.toContain('Clear all')
    const none = render('/employer/applicants?q=kubernetes')
    expect(none).toContain('Clear search')
    expect(none).not.toContain('Clear all filters')
    expect(none).not.toContain('Search all jobs')
    expect(none).not.toContain('Remove “')
  })

  it('sorts from the URL', () => {
    expect(names(render('/employer/applicants?sort=experience'))).toEqual(['ana', 'hid', 'vik']) // 6, 3, 2 years
    expect(names(render('/employer/applicants?sort=score'))).toEqual(['ana', 'vik', 'hid'])
    expect(render('/employer/applicants?sort=experience')).toContain('<option value="experience" selected="">')
  })

  it('shows loading skeletons, a load error with retry, and the two empty states', () => {
    expect(render('/employer/applicants', { applicants: [], loading: true })).toContain('data-testid="applicants-skeleton"')
    const err = render('/employer/applicants', { error: 'x' })
    expect(err).toContain('data-testid="applicants-error"')
    expect(err).toContain('Retry')
    expect(render('/employer/applicants', { applicants: [] })).toContain('No applicants yet')
    expect(render('/employer/applicants', { applicants: [] })).toContain('Post a job')
    const none = render('/employer/applicants?q=kubernetes')
    expect(none).toContain('No applicants match “kubernetes”')
    expect(none).toContain('Clear search')
  })
})

describe('Candidates mode', () => {
  function rail(html: string) {
    const start = html.indexOf('id="applicant-filters"')
    const end = html.indexOf('</aside>')
    return html.slice(start, end)
  }

  it('shows the candidates groups and says candidates', () => {
    const html = render('/employer/applicants', { mode: 'candidates' })
    expect(html).toContain('Showing 1–3 of 3 candidates')
    expect(html).toContain('aria-label="Search candidates"')
    expect(html).toContain('Show candidates')
    // Owner: the filters panel never shows numbers (no option counts, no count in the sheet button).
    const panel = html.slice(html.indexOf('Clear all'), html.indexOf('Show candidates'))
    expect(panel).not.toMatch(/checkCount|fChipCount/)
    const filters = rail(html)
    expect(filters).toContain('Current role')
    expect(filters).toContain('Frontend Developer')
    expect(filters).toContain('Key skills')
    expect(filters).toContain('Find a role')
    expect(filters).toContain('0–1 yr')
    expect(filters).toContain('1–3 yrs')
    expect(filters).toContain('3–5 yrs')
    expect(filters).toContain('5–8 yrs')
    expect(filters).toContain('8+ yrs')
    expect(filters).toContain('Location (mentioned in resume)')
    expect(filters).toContain('Bengaluru')
    expect(filters).toContain('Delhi NCR')
    expect(filters).toContain('Interviewed')
    expect(filters).toContain('Score 80 and above')
    expect(filters).toContain('Score 60 and above')
    expect(filters).toContain('Not interviewed yet')
    // Owner removed the Resume and Last active filter groups.
    expect(filters).not.toContain('Has a resume')
    expect(filters).not.toContain('No resume yet')
    expect(filters).not.toContain('Last 7 days')
    expect(filters).not.toContain('id="fgroup-resume"')
    expect(filters).not.toContain('id="fgroup-active"')
    expect(html).toMatch(/aria-expanded="true"[^>]*>\s*Current role/)
    expect(html).toMatch(/aria-expanded="true"[^>]*>\s*Key skills/)
    expect(html).toMatch(/aria-expanded="true"[^>]*>\s*Experience/)
    expect(html).toMatch(/aria-expanded="true"[^>]*>\s*Location \(mentioned in resume\)/)
    expect(html).toMatch(/aria-expanded="true"[^>]*>\s*Interview/)
    expect(filters).not.toContain('id="fgroup-jobs"')
    expect(filters).not.toContain('id="fgroup-fit"')
    expect(filters).not.toContain('id="fgroup-source"')
    expect(filters).not.toContain('id="fgroup-lists"')
    expect(filters).not.toContain('id="fgroup-score"')
    expect(filters).not.toContain('Has proctoring flags')
    expect(filters).not.toContain('Your lists')
    expect(filters).not.toContain('City in the resume')
    expect(html).not.toContain('Export')
    const empty = render('/employer/applicants', { mode: 'candidates', applicants: [] })
    expect(empty).not.toContain('Post a job')
  })

  it('filters by skill from the URL with one chip, and ignores a stale job link', () => {
    const skill = render('/employer/applicants?skill=Python', { mode: 'candidates' })
    expect(names(skill)).toEqual(['vik'])
    expect(skill).toContain('aria-label="Remove filter Python"')
    expect(names(render('/employer/applicants?jobId=job-fe&fit=80%2B&short=1&saved=1&review=1', { mode: 'candidates' }))).toEqual([
      'ana',
      'vik',
      'hid',
    ])
    expect(names(render('/employer/applicants?role=Frontend%20Developer', { mode: 'candidates' }))).toEqual(['ana'])
  })

  it('shows one chip for the score-60 interview choice', () => {
    const html = render('/employer/applicants?score=80%2B&score=60-79', { mode: 'candidates' })
    expect(html).toContain('aria-label="Remove filter Score 60 and above"')
    expect(html).not.toContain('Score 60 – 79')
    expect(html).not.toContain('Score 80 – 100')
  })

  it('selects no experience radio when the top bar holds a custom range', () => {
    const html = render('/employer/applicants?emin=2&emax=4', { mode: 'candidates' })
    const tags = html.match(/<input[^>]*name="experience-range"[^>]*>/g) || []
    expect(tags.length).toBe(6)
    expect(tags.some((tag) => tag.includes('checked'))).toBe(false)
  })

  it('lists the top eight roles and offers the rest', () => {
    const people = Array.from({ length: 9 }, (_, i) =>
      app({ id: `p${i}`, candidateName: `Person ${i}`, role: `Role ${String.fromCharCode(65 + i)}` }),
    )
    const filters = rail(render('/employer/applicants', { mode: 'candidates', applicants: people }))
    expect(filters).toContain('Show all 9')
    expect(filters).toContain('>Role A<')
    expect(filters).not.toContain('>Role I<')
  })
})

describe('Applicant drawer', () => {
  it('opens the original stored resume for a candidate, even when contact details are hidden', () => {
    const html = render('/employer/candidates?applicant=hid', {
      mode: 'candidates',
      applicants: [
        app({
          id: 'hid',
          jobId: '',
          jobTitle: '',
          recordSource: 'platform',
          candidateName: 'Hidden Person',
          candidateEmail: '',
          candidatePhone: '',
          contactHidden: true,
          candidateUserId: 'user-hid',
          hasResumeFile: true,
          resumeText: 'SKILLS\nGo',
        }),
      ],
    })
    // Original file first (owner's choice); Formatted (Profile details) one click away.
    expect(html).toMatch(/aria-pressed="true"[^>]*>Original</)
    expect(html).toMatch(/aria-pressed="false"[^>]*>Formatted</)
    expect(html).not.toContain('data-testid="profile-details"')
    expect(html).toContain('>Original resume<')
    const downloads = (html.match(/<button\b[^>]*>/g) || []).filter((tag) => tag.includes('Download Hidden Person'))
    expect(downloads.length).toBeGreaterThan(0)
    expect(downloads.every((tag) => !tag.includes('disabled'))).toBe(true)
    expect(downloads.some((tag) => tag.includes('Download the original resume'))).toBe(true)

    const fileOnly = render('/employer/candidates?applicant=hid', {
      mode: 'candidates',
      applicants: [
        app({
          id: 'hid',
          jobId: '',
          jobTitle: '',
          recordSource: 'platform',
          candidateName: 'Hidden Person',
          candidateEmail: '',
          contactHidden: true,
          candidateUserId: 'user-hid',
          hasResumeFile: true,
          resumeText: '',
        }),
      ],
    })
    expect(fileOnly).toContain('Original resume')
    expect(fileOnly).toContain('Loading the resume')
  })

  it('locks the full interview report of a candidate with no link to this organisation', () => {
    const html = render('/employer/candidates?applicant=hid&tab=report', {
      mode: 'candidates',
      applicants: [
        app({
          id: 'hid',
          jobId: '',
          jobTitle: '',
          recordSource: 'platform',
          candidateName: 'Hidden Person',
          candidateEmail: '',
          contactHidden: true,
          resumeText: 'SKILLS\nGo',
          interviewResult: { overall: 72, answers: [], strengths: [], improvements: [], reportRestricted: true } as never,
        }),
      ],
    })
    expect(html).toContain('data-testid="report-locked"')
    expect(html).toContain('72/100')
    expect(html).not.toContain('Open the full report and recording')
  })

  it('is closed without ?applicant and opens as a dialog for the applicant in the URL', () => {
    expect(render()).not.toContain('data-testid="applicant-panel"')
    const html = render('/employer/applicants?applicant=ana')
    expect(html).toContain('data-testid="applicant-panel"')
    expect(html).toMatch(/role="dialog" aria-modal="true" aria-labelledby="applicant-panel-name"/)
    expect(html).toContain('>Ananya Rao</h2>')
    expect(html).toContain('1 of 3')
    // Opens on the original file when one can be shown, otherwise the formatted text.
    expect(html).toMatch(/data-testid="resume-text"|>Original resume</)
  })

  it('opens the tab named in the URL and keeps contact details behind the existing rule', () => {
    const contact = render('/employer/applicants?applicant=ana&tab=contact')
    expect(contact).toMatch(/aria-selected="true"[^>]*>Contact</)
    expect(contact).toContain('mailto:ananya@example.com')

    const hidden = render('/employer/applicants?applicant=hid&tab=contact')
    expect(hidden).toContain('data-testid="contact-locked"')
    expect(hidden).toContain('Share a job&#x27;s apply link')
    expect(hidden).not.toContain('mailto:')
  })
})

describe('Rename: Candidates → Applicants (vendor side)', () => {
  it('the employer footer links to Jobs and Candidates, not a separate applicants page', () => {
    localStorage.setItem('hireright.users', JSON.stringify([{ email: 'r@acme.test', password: 'x', role: 'employer', name: 'R' }]))
    localStorage.setItem('hireright.session', 'r@acme.test')
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AppFooter)))
    expect(html).toContain('href="/employer/jobs"')
    expect(html).toContain('href="/employer/candidates"')
    expect(html).toContain('>Candidates<')
    expect(html).not.toContain('href="/employer/applicants"')
  })
})
