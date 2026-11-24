import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PasswordInput } from '../components/PasswordInput'
import { LoginPage, SignupPage } from '../pages/AuthPages'
import {
  capsLockOn,
  emailFieldError,
  firstInvalidField,
  validateLoginFields,
  validateSignupFields,
} from './authFormValidation'

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
  vi.stubGlobal('window', { location: { search: '', pathname: '/login' }, sessionStorage, localStorage })
})
afterEach(() => vi.unstubAllGlobals())

const render = (el: Parameters<typeof createElement>[0], path = '/login') =>
  renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(el)))

describe('auth field validation', () => {
  it('flags empty and malformed emails, accepts a real one', () => {
    expect(emailFieldError('')).toMatch(/Enter your email/)
    expect(emailFieldError('demo@')).toMatch(/valid email/)
    expect(emailFieldError(' demo@hireright.com ')).toBeUndefined()
  })

  it('login: one message per empty field, none when filled', () => {
    expect(validateLoginFields('', '')).toEqual({
      email: 'Enter your email address.',
      password: 'Enter your password.',
    })
    expect(validateLoginFields('demo@hireright.com', 'password123')).toEqual({})
  })

  it('signup: every rule maps to its own field, in on-screen order', () => {
    const errors = validateSignupFields({
      name: '',
      email: 'x',
      phone: '12',
      password: 'short',
      companyName: '',
      needsCompany: true,
      termsAgreed: false,
    })
    expect(Object.keys(errors)).toEqual(['name', 'company', 'email', 'phone', 'password', 'terms'])
    expect(errors.password).toMatch(/at least 8/)
    expect(
      firstInvalidField({ phone: 'x', email: 'y' }, ['name', 'company', 'email', 'phone', 'password', 'terms']),
    ).toBe('email')
    expect(
      validateSignupFields({
        name: 'Asha',
        email: 'asha@example.com',
        phone: '+91 98765 43210',
        password: 'password123',
        companyName: '',
        needsCompany: false,
        termsAgreed: true,
      }),
    ).toEqual({})
  })
})

describe('PasswordInput', () => {
  it('renders a keyboard-reachable show/hide toggle tied to the field', () => {
    const html = renderToStaticMarkup(
      createElement(PasswordInput, { id: 'pw', autoComplete: 'current-password', value: '', onChange: () => {} }),
    )
    expect(html).toContain('type="password"')
    expect(html).toMatch(/autocomplete="current-password"/i)
    expect(html).toMatch(/<button[^>]*type="button"[^>]*aria-controls="pw"[^>]*aria-pressed="false"[^>]*aria-label="Show password"/)
  })

  it('reads Caps Lock from the key event, false when unsupported', () => {
    expect(capsLockOn({ getModifierState: (k: string) => k === 'CapsLock' })).toBe(true)
    expect(capsLockOn({ getModifierState: () => false })).toBe(false)
    expect(capsLockOn({ getModifierState: () => { throw new Error('nope') } })).toBe(false)
  })
})

describe('Login page presentation', () => {
  it('has one h1, labelled autofill-friendly fields and one primary submit', () => {
    const html = render(LoginPage)
    expect(html.match(/<h1/g)?.length).toBe(1)
    expect(html).toContain('for="login-email"')
    expect(html).toMatch(/autocomplete="email"/i)
    expect(html).toMatch(/autocomplete="current-password"/i)
    expect(html.match(/type="submit"/g)?.length).toBe(1)
    expect(html).toContain('href="/forgot-password"')
    expect(html).toContain('href="/organizations/signup"')
  })

  it('keeps the job-link context: "You’re applying for X at Y"', () => {
    sessionStorage.setItem(
      'hireright.pendingJob',
      JSON.stringify({ shareableCode: 'abc', companySlug: 'acme', jobId: 'j1', title: 'Data Analyst', company: 'Acme' }),
    )
    const html = render(LoginPage)
    expect(html).toContain('You’re applying for <strong>Data Analyst</strong>')
    expect(html).toContain('<strong>Acme</strong>')
  })

  it('tells invite-link visitors they will return to their invitation', () => {
    sessionStorage.setItem('hireright.inviteReturn', '/interview/invite/tok123')
    expect(render(LoginPage)).toContain('Sign in to open your interview invitation')
  })

  it('signup shows the password rule as a hint, not as a placeholder', () => {
    const html = render(SignupPage, '/signup')
    expect(html).toContain('id="signup-pwd-hint"')
    expect(html).toMatch(/autocomplete="new-password"/i)
  })
})
