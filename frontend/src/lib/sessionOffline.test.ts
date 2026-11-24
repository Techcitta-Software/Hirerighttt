/** A request cut off by a quick page change (or no network) must not sign the person out; a rejected token must. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMe = vi.fn()
const mem = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => Array.from(mem.keys())[i] ?? null,
  get length() {
    return mem.size
  },
})
vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), apiMe: () => apiMe() }))

import { getApiToken, setApiToken } from './api'
import { apiSessionStatus, clearSessionValidationCache } from './authSession'
import { isNetworkFailure } from './networkFailure'

describe('session check without an answer', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('hireright.users', JSON.stringify([{ email: 'r@acme.test', role: 'employer', name: 'R' }]))
    localStorage.setItem('hireright.session', 'r@acme.test')
    setApiToken('tok-1')
    clearSessionValidationCache()
    apiMe.mockReset()
  })

  it('classifies fetch failures', () => {
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true)
    expect(isNetworkFailure(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(true)
    expect(isNetworkFailure(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))).toBe(true)
    expect(isNetworkFailure(new Error('Unauthorized'))).toBe(false)
  })

  it('keeps the token when the request was aborted or the network failed', async () => {
    apiMe.mockRejectedValueOnce(Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' }))
    expect(await apiSessionStatus()).toBe('offline')
    expect(getApiToken()).toBe('tok-1')
    apiMe.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await apiSessionStatus()).toBe('offline')
    expect(getApiToken()).toBe('tok-1')
  })

  it('still clears a token the API rejects', async () => {
    apiMe.mockRejectedValueOnce(new Error('Unauthorized'))
    expect(await apiSessionStatus()).toBe('invalid')
    expect(getApiToken()).toBeNull()
  })

  it('is valid when the API confirms the same person', async () => {
    apiMe.mockResolvedValueOnce({ user: { email: 'r@acme.test' } })
    expect(await apiSessionStatus()).toBe('valid')
  })
})
