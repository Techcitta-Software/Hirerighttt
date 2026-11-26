import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmployerApplicant } from '../../lib/store'
import { AppFooter } from '../AppFooter'
import { CareerIntelligenceDashboard } from '../CareerIntelligenceDashboard'
import { ApplicantsSearch, type ApplicantsSearchProps } from './ApplicantsSearch'

// The real report component, wrapped so a test can see it rendered with the drawer's props.
vi.mock('../CareerIntelligenceDashboard', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../CareerIntelligenceDashboard')>()
  return { ...mod, CareerIntelligenceDashboard: vi.fn(mod.CareerIntelligenceDashboard) }
})

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
    const people = ROWS.map((row) =>
      row.id === 'ana' ? ({ ...row, currentLocation: 'Vijayawada' } as EmployerApplicant) : row,
    )
    const html = render('/employer/applicants', { mode: 'candidates', applicants: people })
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
    expect(filters).toContain('Vijayawada')
    expect(filters).not.toContain('Bengaluru')
    expect(filters).not.toContain('Delhi NCR')
    expect(filters).not.toContain('Hyderabad')
    expect(html).toContain('data-testid="tuple-location"')
    expect(html).not.toContain('Save for later')
    expect(html).not.toContain('Saved for later')
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

const tabOrder = (html: string) => Array.from(html.matchAll(/role="tab"[^>]*>([^<]+)</g), (m) => m[1])
const drawer = (html: string) => html.slice(html.indexOf('data-testid="applicant-panel"'))
const selectedTab = (html: string) => html.match(/role="tab" aria-selected="true"[^>]*>([^<]+)</)?.[1]

const KAVYA_RESUME = [
  'Kavya Iyer',
  'Frontend Developer | Chennai, India | kavya@example.com',
  'SUMMARY',
  'Frontend developer with 4 years building fast, accessible React apps.',
  'EXPERIENCE',
  'Frontend Developer, CartWave Technologies, Chennai (Jun 2022 - Present)',
  '- Rebuilt checkout in React 18 and TypeScript.',
  'SKILLS',
  'React, TypeScript, Storybook',
  'EDUCATION',
  'B.Tech Information Technology, Anna University, 2020',
  'CERTIFICATIONS',
  '- AWS Certified Cloud Practitioner',
  'LANGUAGES',
  'English, Tamil, Hindi',
].join('\n')

describe('Applicant drawer', () => {
  it('lands on Profile, with the tabs in the order Profile, Resume, Interview report', () => {
    const html = render('/employer/applicants?applicant=ana')
    expect(tabOrder(html)).toEqual(['Profile', 'Resume', 'Interview report'])
    expect(selectedTab(html)).toBe('Profile')
    expect(html).toContain('id="applicant-tabpanel-profile"')
    expect(html).toContain('data-testid="profile-details"')
    // Roving tabindex: only the selected tab is in the tab order.
    expect(html).toMatch(/id="applicant-tab-profile"[^>]*aria-selected="true"[^>]*tabindex="0"/)
    expect(html).toMatch(/id="applicant-tab-resume"[^>]*aria-selected="false"[^>]*tabindex="-1"/)
    // The Contact tab is gone; contact is a section of Profile.
    expect(html).not.toContain('id="applicant-tab-contact"')
    expect(html).toContain('data-testid="profile-contact"')
  })

  it('maps old tab=contact links to Profile and keeps tab=resume / tab=report', () => {
    expect(selectedTab(render('/employer/applicants?applicant=ana&tab=contact'))).toBe('Profile')
    expect(selectedTab(render('/employer/applicants?applicant=ana&tab=resume'))).toBe('Resume')
    expect(selectedTab(render('/employer/applicants?applicant=ana&tab=report'))).toBe('Interview report')
  })

  it('reads the resume as a profile: about, skills with search hits, experience, education, certifications, languages', () => {
    const rows = [app({ id: 'kav', candidateName: 'Kavya Iyer', resumeText: KAVYA_RESUME, aiScore: 71 })]
    const html = render('/employer/applicants?applicant=kav&q=storybook', { applicants: rows })
    expect(html).toContain('data-testid="profile-about"')
    expect(html).toContain('Frontend developer with 4 years building fast')
    expect(html).toContain('data-testid="profile-skills"')
    expect(html).toContain('1 matches your search')
    expect(html).toMatch(/skillChipHit[^"]*"><svg[\s\S]*?<mark[^>]*>Storybook<\/mark>/)
    expect(html).toContain('data-testid="profile-experience"')
    expect(html).toContain('CartWave Technologies')
    expect(html).toContain('Jun 2022 – Present')
    expect(html).toContain('data-testid="profile-education"')
    expect(html).toContain('AWS Certified Cloud Practitioner')
    expect(html).toContain('data-testid="profile-languages"')
    expect(html).toContain('>Tamil<')
    // Interview summary card and the header line from the resume headline.
    expect(html).toContain('aria-label="Interview summary"')
    expect(html).toContain('View interview report')
    expect(html).toContain('Frontend Developer at CartWave Technologies')
    // Sections with nothing to show are left out (no projects on this resume).
    expect(html).not.toContain('data-testid="profile-projects"')
  })

  it('always shows the Contact section: e-mail and phone with copy buttons, never a locked state', () => {
    const open = render('/employer/candidates?applicant=plat', {
      mode: 'candidates',
      applicants: [
        app({
          id: 'plat',
          jobId: '',
          jobTitle: '',
          recordSource: 'platform',
          candidateName: 'Platform Person',
          candidateEmail: 'platform.person@example.com',
          candidatePhone: '919876543210',
          // A stale flag from an older API must not hide anything (owner decision).
          contactHidden: true,
          resumeText: 'SKILLS\nGo',
        }),
      ],
    })
    expect(open).toContain('data-testid="profile-contact"')
    expect(open).toContain('mailto:platform.person@example.com')
    expect(open).toContain('tel:+919876543210')
    expect(open).toContain('Copy email')
    expect(open).toContain('Copy phone number')
    expect(open).toContain('data-testid="panel-contact"')
    expect(open).not.toContain('contact-locked')
    expect(open).not.toContain('Contact locked')
    expect(open).not.toContain('until they apply')

    // No e-mail on the row at all: the section still shows, with "Not provided".
    const empty = render('/employer/applicants?applicant=hid')
    expect(empty).toContain('data-testid="profile-contact"')
    expect(empty).toContain('Not provided')
    expect(empty).not.toContain('contact-locked')
    expect(empty).toContain('Not interviewed yet.')
  })

  it('Resume shows only the original file with Download: no Formatted toggle and no extracted text', () => {
    const html = render('/employer/candidates?applicant=hid&tab=resume', {
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
          resumeName: 'Hidden_Person.pdf',
          resumeText: 'SKILLS\nGo',
        }),
      ],
    })
    expect(html).not.toContain('Formatted')
    expect(html).not.toContain('>Original<')
    expect(html).not.toContain('Full resume text')
    expect(html).not.toContain('data-testid="resume-text"')
    expect(html).not.toContain('data-testid="profile-details"')
    expect(html).toContain('Hidden_Person.pdf')
    expect(html).toContain('Loading the resume')
    const downloads = (html.match(/<button\b[^>]*>/g) || []).filter((tag) => tag.includes('Download Hidden Person'))
    // The Resume tab's own Download, beside the file name (the header keeps its Download too).
    expect(downloads.filter((tag) => tag.includes('original resume&quot;') || tag.includes('s original resume"')).length).toBe(1)
    expect(downloads.every((tag) => !tag.includes('disabled'))).toBe(true)
  })

  it('Resume without a stored file: a clean empty state pointing to Profile, never the extracted text', () => {
    const html = render('/employer/candidates?applicant=vik&tab=resume', { mode: 'candidates' })
    expect(html).toContain('data-testid="resume-empty"')
    expect(html).toContain('No resume file uploaded')
    expect(html).toContain('Profile tab')
    expect(html).toContain('Go to Profile')
    expect(drawer(html)).not.toContain('FastAPI')
    expect(html).not.toContain('Loading the resume')

    // An application: the original file loads (no locked state any more).
    const applied = render('/employer/applicants?applicant=ana&tab=resume')
    expect(applied).not.toContain('resume-locked')
    expect(applied).toContain('Loading the resume')
  })

  it('shows the full interview report of a platform candidate (no locked state)', () => {
    const html = render('/employer/candidates?applicant=plat&tab=report', {
      mode: 'candidates',
      applicants: [
        app({
          id: 'plat',
          jobId: '',
          jobTitle: '',
          recordSource: 'platform',
          candidateName: 'Platform Person',
          candidateEmail: 'platform.person@example.com',
          resumeText: 'SKILLS\nGo',
          interviewResult: {
            overall: 72,
            role: 'Backend Engineer',
            level: 'mid',
            date: new Date(NOW - 86_400_000).toISOString(),
            categories: [],
            answers: [{ question: 'Q?', answer: 'An answer' }],
            strengths: [],
            improvements: [],
          } as never,
        }),
      ],
    })
    expect(html).not.toContain('report-locked')
    expect(html).toMatch(/<strong>72<\/strong><span[^>]*>\/100</)
    expect(html).toContain('Open the full report and recording')
  })

  it('the Interview report tab still renders the report (CareerIntelligenceDashboard) as before', () => {
    const result = {
      overall: 81,
      role: 'Frontend Developer',
      level: 'mid',
      date: new Date(NOW - 86_400_000).toISOString(),
      categories: [],
      answers: [],
      strengths: ['Clear explanations'],
      improvements: [],
    }
    const rows = [app({ id: 'ana', candidateName: 'Ananya Rao', aiScore: 81, interviewResult: result as never })]
    vi.mocked(CareerIntelligenceDashboard).mockClear()
    const html = render('/employer/applicants?applicant=ana&tab=report', { applicants: rows })
    expect(html).toContain('id="applicant-tabpanel-report"')
    expect(html).toContain('Open the full report and recording')
    expect(html).toContain('81/100')
    // The report component itself, with the same props as before (its UI is not touched by the drawer).
    const calls = vi.mocked(CareerIntelligenceDashboard).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.at(-1)?.[0]).toMatchObject({ embedded: true, result, candidateName: 'Ananya Rao' })
    expect(selectedTab(html)).toBe('Interview report')
  })

  it('is closed without ?applicant and opens as a dialog for the applicant in the URL', () => {
    expect(render()).not.toContain('data-testid="applicant-panel"')
    const html = render('/employer/applicants?applicant=ana')
    expect(html).toContain('data-testid="applicant-panel"')
    expect(html).toMatch(/role="dialog" aria-modal="true" aria-labelledby="applicant-panel-name"/)
    expect(html).toContain('>Ananya Rao</h2>')
    expect(html).toContain('1 of 3')
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
