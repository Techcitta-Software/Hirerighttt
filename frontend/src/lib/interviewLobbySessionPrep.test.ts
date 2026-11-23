import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LOBBY_SESSION_PREP_TTL_MS,
  beginLobbySessionPrep,
  invalidateLobbySessionPrep,
  lobbySessionPrepKey,
  peekLobbySessionPrep,
} from './interviewLobbySessionPrep'

describe('interviewLobbySessionPrep', () => {
  beforeEach(() => {
    invalidateLobbySessionPrep()
    vi.useFakeTimers()
  })

  afterEach(() => {
    invalidateLobbySessionPrep()
    vi.useRealTimers()
  })

  it('dedupes prep for the same lobby key', async () => {
    const run = vi.fn().mockResolvedValue({ started: { sessionId: 's1' } })
    const key = 'role|level'
    const p1 = beginLobbySessionPrep(key, run)
    const p2 = beginLobbySessionPrep(key, run)
    expect(p1).toBe(p2)
    expect(run).toHaveBeenCalledTimes(1)
    await p1
  })

  it('restarts prep when the key changes', async () => {
    const run = vi.fn().mockResolvedValue({ started: { sessionId: 's1' } })
    await beginLobbySessionPrep('a', run)
    await beginLobbySessionPrep('b', run)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('drops failed prep so join can retry', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ started: { sessionId: 's2' } })
    const key = 'k1'
    await expect(beginLobbySessionPrep(key, run)).rejects.toThrow('network')
    expect(peekLobbySessionPrep(key)).toBeNull()
    await beginLobbySessionPrep(key, run)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('expires stale lobby prep', async () => {
    const run = vi.fn().mockResolvedValue({ started: { sessionId: 's1' } })
    const key = 'stale'
    await beginLobbySessionPrep(key, run)
    vi.advanceTimersByTime(LOBBY_SESSION_PREP_TTL_MS + 1)
    expect(peekLobbySessionPrep(key)).toBeNull()
  })

  it('builds a stable lobby key from job + invite context', () => {
    const k1 = lobbySessionPrepKey({
      role: 'Engineer',
      level: 'Mid',
      targetJobRaw: { jobId: 'j1', title: 'X', company: 'Y', role: 'Engineer', level: 'Mid', jd: 'Build APIs' },
      customJd: '',
      interviewConsent: { recording: true, faceTracking: true, aiScoring: true, version: 'v1', acceptedAt: '' },
    })
    const k2 = lobbySessionPrepKey({
      role: 'Engineer',
      level: 'Mid',
      targetJobRaw: { jobId: 'j1', title: 'X', company: 'Y', role: 'Engineer', level: 'Mid', jd: 'Build APIs' },
      customJd: '',
      interviewConsent: { recording: true, faceTracking: true, aiScoring: true, version: 'v1', acceptedAt: '' },
    })
    expect(k1).toBe(k2)
    expect(k1).toContain('j1')
  })
})