import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApplyPath, buildApplyUrl, publicAppOrigin } from './jobLink'

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

  it('never invent a localhost host without a window', () => {
    vi.stubEnv('VITE_PUBLIC_APP_URL', '')
    vi.stubGlobal('window', undefined)
    expect(buildApplyUrl('Acme', 'x1')).toBe('/apply/acme/x1')
    expect(buildApplyUrl('Acme', 'x1')).toBe(buildApplyPath('Acme', 'x1'))
  })
})
