import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotFoundPage } from '../pages/NotFoundPage'
import { brandedInviteTitle } from './brandText'
import { jobDescriptionBullets } from './jobText'
import { profileGapsExcludingInterview, type ProfileFieldCheck } from './profileCompletion'

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

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
})
afterEach(() => vi.unstubAllGlobals())

const check = (section: ProfileFieldCheck['section'], label: string): ProfileFieldCheck => ({
  label,
  section,
  done: false,
  required: true,
  hint: '',
  icon: 'user',
})

describe('dashboard next step', () => {
  it('does not call the AI interview a profile gap (it is its own next step)', () => {
    const onlyInterview = [check('interview', 'AI interview score')]
    expect(profileGapsExcludingInterview(onlyInterview)).toEqual([])
    const mixed = [check('interview', 'AI interview score'), check('basics', 'Current city')]
    expect(profileGapsExcludingInterview(mixed).map((c) => c.label)).toEqual(['Current city'])
  })
})

describe('brand text', () => {
  it('shows legacy "HireRight AI Interview" invite titles with the real brand', () => {
    expect(brandedInviteTitle('HireRight AI Interview')).toBe('HireRighttt AI Interview')
    expect(brandedInviteTitle('Senior Frontend Developer')).toBe('Senior Frontend Developer')
    expect(brandedInviteTitle(undefined)).toBeUndefined()
  })
})

describe('404 page', () => {
  const render = () => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(NotFoundPage)))

  it('offers sign in to visitors', () => {
    const html = render()
    expect(html).toContain('href="/login"')
    expect(html).not.toContain('Go to dashboard')
  })

  it('offers the dashboard (not "Sign in") to a signed-in candidate', () => {
    localStorage.setItem(
      'hireright.users',
      JSON.stringify([{ id: 'u1', email: 'demo@hireright.com', name: 'Arjun', role: 'jobseeker' }]),
    )
    localStorage.setItem('hireright.session', 'demo@hireright.com')
    const html = render()
    expect(html).toContain('Go to dashboard')
    expect(html).toContain('href="/dashboard"')
    expect(html).not.toContain('>Sign in<')
  })
})

describe('job card description', () => {
  it('does not repeat a one-paragraph JD as a bullet under itself', () => {
    const jd = 'We are hiring a Senior Frontend Developer to build and maintain customer-facing products.'
    expect(jobDescriptionBullets(jd, jd.slice(0, 600))).toEqual([])
  })

  it('keeps distinct lines from a multi-line JD', () => {
    const jd = ['Intro paragraph about the team and the product.', '- Build accessible React components', '- Own the design system tokens'].join(String.fromCharCode(10))
    expect(jobDescriptionBullets(jd, 'Short summary')).toEqual([
      'Intro paragraph about the team and the product.',
      'Build accessible React components',
      'Own the design system tokens',
    ])
  })
})
