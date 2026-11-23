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

  it('applies filters and keywords from the URL, with removable chips and facet counts', () => {
    const html = render('/employer/applicants?skill=Python')
    expect(names(html)).toEqual(['vik'])
    expect(html).toContain('aria-label="Remove filter Python"')

    const byJob = render('/employer/applicants?jobId=job-fe')
    expect(names(byJob)).toEqual(['ana'])

    const kw = render('/employer/applicants?q=typescript')
    expect(names(kw)).toEqual(['ana'])
    expect(kw).toContain('<mark')
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
    const none = render('/employer/applicants?q=kubernetes')
    expect(none).toContain('No applicants match “kubernetes”')
    expect(none).toContain('Clear all filters')
  })
})

describe('Applicant drawer', () => {
  it('is closed without ?applicant and opens as a dialog for the applicant in the URL', () => {
    expect(render()).not.toContain('data-testid="applicant-panel"')
    const html = render('/employer/applicants?applicant=ana')
    expect(html).toContain('data-testid="applicant-panel"')
    expect(html).toMatch(/role="dialog" aria-modal="true" aria-labelledby="applicant-panel-name"/)
    expect(html).toContain('>Ananya Rao</h2>')
    expect(html).toContain('1 of 3')
    expect(html).toContain('data-testid="resume-text"')
  })

  it('opens the tab named in the URL and keeps contact details behind the existing rule', () => {
    const contact = render('/employer/applicants?applicant=ana&tab=contact')
    expect(contact).toMatch(/aria-selected="true"[^>]*>Contact</)
    expect(contact).toContain('mailto:ananya@example.com')

    const hidden = render('/employer/applicants?applicant=hid&tab=contact')
    expect(hidden).toContain('data-testid="contact-locked"')
    expect(hidden).toContain('Invite to apply')
    expect(hidden).not.toContain('mailto:')
  })
})

describe('Rename: Candidates → Applicants (vendor side)', () => {
  it('the employer footer links to Jobs and Talent vault, not a separate applicants page', () => {
    localStorage.setItem('hireright.users', JSON.stringify([{ email: 'r@acme.test', password: 'x', role: 'employer', name: 'R' }]))
    localStorage.setItem('hireright.session', 'r@acme.test')
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AppFooter)))
    expect(html).toContain('href="/employer/jobs"')
    expect(html).toContain('href="/talent-vault"')
    expect(html).not.toContain('href="/employer/applicants"')
  })
})
