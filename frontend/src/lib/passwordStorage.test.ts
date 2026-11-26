/** P1 regression: passwords must never be written to browser storage (hireright.users / signup handoff). */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mem = new Map<string, string>()
const sessionMem = new Map<string, string>()
function fakeStorage(store: Map<string, string>) {
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size
    },
  }
}
vi.stubGlobal('localStorage', fakeStorage(mem))
vi.stubGlobal('sessionStorage', fakeStorage(sessionMem))
vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} })

const apiLogin = vi.fn()
const apiSignup = vi.fn()
const apiMe = vi.fn()
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  apiLogin: (...a: unknown[]) => apiLogin(...a),
  apiSignup: (...a: unknown[]) => apiSignup(...a),
  apiMe: () => apiMe(),
  apiHealth: async () => true,
}))

import { setApiToken } from './api'
import { ensureApiSession } from './apiSession'
import { consumeSignupLoginHandoff, stashSignupLoginHandoff } from './authHandoff'
import { getUser, login, saveUser, setLocalOfflinePassword } from './store'

const SECRET = 'Sup3r$ecret!'

function everythingStored(): string {
  return [...mem.values(), ...sessionMem.values()].join('\n')
}

describe('no plaintext passwords in the browser', () => {
  beforeEach(() => {
    mem.clear()
    sessionMem.clear()
    apiLogin.mockReset()
    apiSignup.mockReset()
    apiMe.mockReset()
    setApiToken(null)
  })

  it('saveUser never writes a password, even if a caller passes one', () => {
    saveUser({ name: 'R', email: 'R@Acme.test', role: 'employer', companyName: 'Acme', ...({ password: SECRET } as object) })
    expect(everythingStored()).not.toContain(SECRET)
    const rows = JSON.parse(mem.get('hireright.users') || '[]') as Record<string, unknown>[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).not.toHaveProperty('password')
    expect(getUser()?.email).toBe('r@acme.test')
  })

  it('strips passwords saved by older builds on the next read', () => {
    mem.set(
      'hireright.users',
      JSON.stringify([{ id: '1', email: 'old@acme.test', name: 'Old', role: 'jobseeker', password: SECRET, createdAt: 'x' }]),
    )
    mem.set('hireright.session', 'old@acme.test')
    expect(getUser()?.name).toBe('Old')
    expect(mem.get('hireright.users')).not.toContain(SECRET)
    expect(mem.get('hireright.users')).not.toContain('password')
  })

  it('strips the legacy single-user key too', () => {
    mem.set('hireright.user', JSON.stringify({ email: 'leg@acme.test', name: 'L', password: SECRET }))
    mem.set('hireright.session', 'leg@acme.test')
    expect(getUser()?.email).toBe('leg@acme.test')
    expect(everythingStored()).not.toContain(SECRET)
  })

  it('offline-only accounts keep a digest, never the password, and can still sign in', async () => {
    saveUser({ name: 'Off', email: 'off@local.test', role: 'jobseeker' }, true, false)
    await setLocalOfflinePassword('off@local.test', SECRET)
    expect(everythingStored()).not.toContain(SECRET)
    expect(await login('off@local.test', 'wrong')).toBeNull()
    expect((await login('off@local.test', SECRET))?.email).toBe('off@local.test')
  })

  it('API-backed accounts never sign in from the browser list', async () => {
    saveUser({ name: 'Api', email: 'api@acme.test', role: 'jobseeker' }, true, false)
    expect(await login('api@acme.test', '')).toBeNull()
    expect(await login('api@acme.test', SECRET)).toBeNull()
  })

  it('signup -> login handoff keeps the password in memory only', () => {
    stashSignupLoginHandoff({ email: 'new@acme.test', password: SECRET, message: 'Account created' })
    expect(everythingStored()).not.toContain(SECRET)
    const handoff = consumeSignupLoginHandoff()
    expect(handoff).toEqual({ email: 'new@acme.test', password: SECRET, message: 'Account created' })
    expect(consumeSignupLoginHandoff()).toBeNull()
  })

  it('ensureApiSession uses the stored token and never re-logs-in with a stored password', async () => {
    saveUser({ name: 'R', email: 'r@acme.test', role: 'employer' })
    setApiToken('tok-1')
    apiMe.mockResolvedValue({ user: { email: 'r@acme.test' } })
    expect(await ensureApiSession()).toBe(true)
    expect(apiLogin).not.toHaveBeenCalled()

    // Token rejected: no password-based silent login or re-signup is attempted.
    saveUser({ name: 'S', email: 's@acme.test', role: 'employer', phone: '9999999999' })
    setApiToken('tok-2')
    apiMe.mockRejectedValue(new Error('Unauthorized'))
    expect(await ensureApiSession()).toBe(false)
    expect(apiLogin).not.toHaveBeenCalled()
    expect(apiSignup).not.toHaveBeenCalled()
  })
})
