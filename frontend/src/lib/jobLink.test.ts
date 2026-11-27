import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApplyPath, buildApplyUrl, canonicalJobPath, publicAppOrigin } from './jobLink'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('share links', () => {
  it('use VITE_PUBLIC_APP_URL when it is set (trailing slash removed)', () => {
    vi.stubEnv('VITE_PUBLIC_APP_URL', 'https://jobs.example.com/')
    expect(publicAppOrigin()).toBe('https://jobs.example.com')
    expect(buildApplyUrl('Acme Corp', 'abc123')).toBe('https://jobs.example.com/apply/acme-corp/abc123')
  })

  it('fall back to the page origin when the variable is unset', () => {
    vi.stubEnv('VITE_PUBLIC_APP_URL', '')
    vi.stubGlobal('window', { location: { origin: 'https://staging.example.com' } })
    expect(buildApplyUrl('Acme', 'x1')).toBe('https://staging.example.com/apply/acme/x1')
  })

  it('replaces a job URL when the code is right and the company slug is not', () => {
    const job = { company: 'Acme Corp', companySlug: 'acme-corp' }
    expect(canonicalJobPath('jobs', 'abc123', 'wrong-co', job)).toBe('/jobs/acme-corp/abc123')
    expect(canonicalJobPath('apply', 'abc123', 'not-acme', job)).toBe('/apply/acme-corp/abc123')
    expect(canonicalJobPath('jobs', 'abc123', 'acme-corp', job)).toBeNull()
    expect(canonicalJobPath('jobs', 'abc123', 'ACME-CORP', job)).toBeNull()
    expect(canonicalJobPath('apply', 'abc123', undefined, job)).toBeNull()
    expect(canonicalJobPath('jobs', 'pay42', 'other', { company: 'Payflow' })).toBe('/jobs/payflow/pay42')
  })

  it('never invent a localhost host without a window', () => {
    vi.stubEnv('VITE_PUBLIC_APP_URL', '')
    vi.stubGlobal('window', undefined)
    expect(buildApplyUrl('Acme', 'x1')).toBe('/apply/acme/x1')
    expect(buildApplyUrl('Acme', 'x1')).toBe(buildApplyPath('Acme', 'x1'))
  })
})
