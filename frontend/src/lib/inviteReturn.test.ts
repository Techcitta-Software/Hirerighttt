import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearInviteReturn, consumeInviteReturn, peekInviteReturn, readInviteEmail, rememberInviteReturn } from './inviteReturn'

describe('inviteReturn', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
  })

  it('remembers the emailed link and the invited address', () => {
    rememberInviteReturn('/interview/invite/abc123', 'asha@example.com')
    expect(peekInviteReturn()).toBe('/interview/invite/abc123')
    expect(readInviteEmail()).toBe('asha@example.com')
  })

  it('returns the link exactly once', () => {
    rememberInviteReturn('/interview/invite/abc123')
    expect(consumeInviteReturn()).toBe('/interview/invite/abc123')
    expect(consumeInviteReturn()).toBeNull()
  })

  it('refuses to redirect anywhere except an invite page (no open redirect)', () => {
    rememberInviteReturn('https://evil.example/phish')
    expect(peekInviteReturn()).toBeNull()
    rememberInviteReturn('/admin')
    expect(peekInviteReturn()).toBeNull()
  })

  it('can be cleared', () => {
    rememberInviteReturn('/interview/invite/x', 'a@b.co')
    clearInviteReturn()
    expect(peekInviteReturn()).toBeNull()
    expect(readInviteEmail()).toBe('')
  })
})
