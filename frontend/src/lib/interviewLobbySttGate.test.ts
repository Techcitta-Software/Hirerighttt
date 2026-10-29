import { describe, expect, it, vi } from 'vitest'
import {
  isLobbyLocalSttReady,
  lobbyEnterButtonLabel,
  lobbyLocalSttBlockedReason,
  waitForLobbyLocalStt,
  type LobbySttSnapshot,
} from './interviewLobbySttGate'

describe('interviewLobbySttGate', () => {
  it('isLobbyLocalSttReady requires Moonshine ready and Silero VAD', () => {
    expect(
      isLobbyLocalSttReady({ moonshineStatus: 'ready', vadReady: true }),
    ).toBe(true)
    expect(
      isLobbyLocalSttReady({ moonshineStatus: 'downloading', vadReady: true }),
    ).toBe(false)
    expect(
      isLobbyLocalSttReady({ moonshineStatus: 'ready', vadReady: false }),
    ).toBe(false)
  })

  it('lobbyEnterButtonLabel stays neutral while voice AI loads in background', () => {
    expect(lobbyEnterButtonLabel({ starting: false })).toBe('Enter interview room')
    expect(lobbyEnterButtonLabel({ starting: true })).toBe('Joining interview room…')
  })

  it('lobbyLocalSttBlockedReason is silent while downloading', () => {
    expect(lobbyLocalSttBlockedReason({ moonshineStatus: 'idle', vadReady: true })).toBeNull()
    expect(
      lobbyLocalSttBlockedReason({ moonshineStatus: 'downloading', vadReady: true }),
    ).toBeNull()
  })

  it('waitForLobbyLocalStt resolves immediately when already ready', async () => {
    const waitMoonshine = vi.fn()
    const waitVad = vi.fn()
    const result = await waitForLobbyLocalStt(
      () => ({ moonshineStatus: 'ready', vadReady: true }),
      { waitMoonshine, waitVad },
    )
    expect(result).toEqual({ ok: true })
    expect(waitMoonshine).not.toHaveBeenCalled()
  })

  it('waitForLobbyLocalStt waits for Moonshine when candidate clicks enter before download', async () => {
    let snap: LobbySttSnapshot = { moonshineStatus: 'idle', vadReady: false }
    const waitMoonshine = vi.fn(async () => {
      snap = { moonshineStatus: 'ready', vadReady: true }
      return true
    })
    const waitVad = vi.fn(async () => true)

    const result = await waitForLobbyLocalStt(() => snap, {
      waitMoonshine,
      waitVad,
      pollMs: 10,
      vadMaxMs: 500,
    })

    expect(waitMoonshine).toHaveBeenCalled()
    expect(result).toEqual({ ok: true })
  })

  it('waitForLobbyLocalStt fails when Moonshine errors', async () => {
    const result = await waitForLobbyLocalStt(
      () => ({ moonshineStatus: 'error', vadReady: false }),
      {
        waitMoonshine: vi.fn(),
        waitVad: vi.fn(),
      },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/failed to load/)
    }
  })

  it('waitForLobbyLocalStt fails on Moonshine timeout', async () => {
    const result = await waitForLobbyLocalStt(
      () => ({ moonshineStatus: 'downloading', vadReady: true }),
      {
        waitMoonshine: vi.fn(async () => false),
        waitVad: vi.fn(),
      },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/timed out/)
    }
  })
})
