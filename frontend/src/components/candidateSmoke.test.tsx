import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INVITE_ERROR_KEY } from '../lib/pendingJobApply'
import { profileCheckHref, profileFieldChecks } from '../lib/profileCompletion'
import { InterviewRetakePricingPage } from '../pages/InterviewRetakePricingPage'
import { JobLinkNotice } from './JobLinkNotice'

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size
    },
  }
}

const html = (el: ReactElement) => renderToStaticMarkup(createElement(MemoryRouter, null, el))

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
})
afterEach(() => vi.unstubAllGlobals())

describe('JobLinkNotice (home page after a recruiter job link)', () => {
  it('shows why a job link failed instead of silently landing on the home page', () => {
    sessionStorage.setItem(INVITE_ERROR_KEY, 'Job link not found or expired.')
    const out = html(createElement(JobLinkNotice))
    expect(out).toContain('role="alert"')
    expect(out).toContain('Job link not found or expired.')
    expect(out).toContain('aria-label="Dismiss"')
  })

  it('tells a signed-out candidate which role they are applying for, with sign-up and log-in', () => {
    sessionStorage.setItem(
      'hireright.pendingJob',
      JSON.stringify({ shareableCode: 'abc', companySlug: 'acme', jobId: 'j1', title: 'Senior Frontend Developer', company: 'Acme', role: '', level: '', jd: '' }),
    )
    const out = html(createElement(JobLinkNotice))
    expect(out).toContain('Senior Frontend Developer')
    expect(out).toContain('at Acme')
    expect(out).toContain('href="/signup"')
    expect(out).toContain('href="/login"')
  })

  it('renders nothing without a job link', () => {
    expect(html(createElement(JobLinkNotice))).toBe('')
  })
})

describe('InterviewRetakePricingPage', () => {
  it('does not offer a free "continue" before the retake status is known', () => {
    // Regression: the page sent everyone to the interview room, where the server answers 402 after the free interview.
    const out = html(createElement(InterviewRetakePricingPage))
    expect(out).toContain('Checking your interviews…')
    expect(out).toMatch(/<button[^>]*disabled/)
    expect(out).not.toContain('No payment gateway yet')
    expect(out).toContain('href="/dashboard"')
  })
})

describe('dashboard profile checklist', () => {
  it('never points finished candidates at onboarding (it redirects them to the dashboard)', () => {
    const checks = profileFieldChecks({ completedSteps: 5 } as never, { email: 'a@example.com', name: 'A' } as never)
    const cert = checks.find((c) => c.label === 'Certifications')
    expect(cert).toBeTruthy()
    expect(profileCheckHref(cert!)).toBe('/profile#resume')
    for (const c of checks) expect(profileCheckHref(c)).not.toMatch(/^\/onboarding/)
  })
})
