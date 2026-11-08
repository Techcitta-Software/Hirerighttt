import { beforeEach, describe, expect, it, vi } from 'vitest'

// Profile progress is the only thing that changes between cases.
let completedSteps = 0
vi.mock('./store', () => ({
  getProfile: () => ({ completedSteps }),
  getUser: () => null,
  logout: () => undefined,
}))

import { resolveAuthenticatedDestination } from './authSession'
import { peekInviteReturn, rememberInviteReturn } from './inviteReturn'

const candidate = { id: 'c1', name: 'Asha', email: 'asha@example.com', role: 'jobseeker' } as never
const INVITE = '/interview/invite/abc123'

describe('after sign-in from an emailed interview link', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    }
    vi.stubGlobal('sessionStorage', storage)
    vi.stubGlobal('localStorage', storage)
  })

  it('goes straight back to the interview link once the profile step is done (onboarding not finished)', () => {
    completedSteps = 4 // booked a slot, never clicked "Finish"
    rememberInviteReturn(INVITE)
    expect(resolveAuthenticatedDestination(candidate)).toBe(INVITE)
    expect(peekInviteReturn()).toBeNull()
  })

  it('sends a brand-new candidate to add their resume first, keeping the link for afterwards', () => {
    completedSteps = 0
    rememberInviteReturn(INVITE)
    expect(resolveAuthenticatedDestination(candidate)).toBe('/onboarding?step=1')
    expect(peekInviteReturn()).toBe(INVITE)
  })

  it('also honours the link passed as the "from" page', () => {
    completedSteps = 5
    expect(resolveAuthenticatedDestination(candidate, INVITE)).toBe(INVITE)
  })

  it('without an invite, unfinished onboarding still goes to onboarding', () => {
    completedSteps = 3
    expect(resolveAuthenticatedDestination(candidate)).toBe('/onboarding?step=2')
  })
})
