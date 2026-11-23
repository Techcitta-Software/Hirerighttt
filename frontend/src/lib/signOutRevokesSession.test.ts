import { beforeEach, describe, expect, it, vi } from 'vitest'

// E2E journey regression: "Sign out" (SignOutModal / LogoutPage) runs supabaseSignOut() and then apiLogout().
// supabaseSignOut() used to clear the API token even when Supabase is off, so apiLogout() found no token, never called
// POST /api/logout, and the server session stayed valid after the user signed out.
vi.mock('./supabaseClient', () => ({
  getSupabase: () => Promise.resolve(null),
  isSupabaseEnabled: () => false,
}))

import { apiLogout, getApiToken, setApiToken } from './api'
import { supabaseSignOut } from './supabaseAuth'

describe('sign out without Supabase', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
  })

  it('revokes the API session on the server, then clears the token', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    setApiToken('tok-123')

    await supabaseSignOut()
    expect(getApiToken()).toBe('tok-123') // still there for apiLogout
    await apiLogout()

    const logoutCall = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([url]) =>
      String(url).endsWith('/api/logout'),
    )
    expect(logoutCall).toBeTruthy()
    expect((logoutCall![1].headers as Record<string, string>).Authorization).toBe('Bearer tok-123')
    expect(getApiToken()).toBeNull()
  })
})
