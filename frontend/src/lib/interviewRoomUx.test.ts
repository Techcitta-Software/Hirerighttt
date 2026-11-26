/** Interview-room UX regressions from the T5 test run (speech watchdog, cookie bar, proctoring labels/counts). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./neuralVoice', () => ({
  // /api/interview/tts failed (503/429): the neural voice did not speak.
  speakNeural: vi.fn(async () => false),
  cancelNeuralSpeech: vi.fn(),
}))

import { cookieBannerHiddenOn } from './cookieConsent'
import { proctorFlagBreakdown, proctorFlagCount, proctorNotes } from './applicantSearch'
import { buildTimelineMarkers, formatSpan, markerTooltip, timelineSummary } from './proctorTimeline'
import { SPEECH_START_TIMEOUT_MS, SPEECH_WATCHDOG_MARGIN_MS, estimatedSpeechMs, speakText } from './speech'
import type { EmployerApplicant, IntegrityLogEvent } from './store'

type FakeUtterance = { text: string; onstart?: () => void; onend?: () => void; onerror?: () => void }

function installSpeech(opts: { voices: number; firesEvents: boolean }) {
  const spoken: FakeUtterance[] = []
  const synth = {
    speaking: false,
    getVoices: () => Array.from({ length: opts.voices }, () => ({ lang: 'en-US', name: 'X', localService: true })),
    cancel: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    speak: (u: FakeUtterance) => {
      spoken.push(u)
      if (opts.firesEvents) {
        u.onstart?.()
        setTimeout(() => u.onend?.(), 1000)
      }
    },
  }
  ;(globalThis as Record<string, unknown>).window = Object.assign(globalThis, { speechSynthesis: synth })
  ;(globalThis as Record<string, unknown>).SpeechSynthesisUtterance = function (this: FakeUtterance, text: string) {
    this.text = text
  }
  return { spoken, synth }
}

describe('"Ava is speaking" can never hang (TTS failed, device has no voices)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    delete (globalThis as Record<string, unknown>).speechSynthesis
  })

  it('ends the speech by watchdog so the answer window opens', async () => {
    installSpeech({ voices: 0, firesEvents: false })
    const onEnd = vi.fn()
    speakText('Tell me about a project where you used PostgreSQL indexes.', { onEnd })
    await vi.advanceTimersByTimeAsync(500 + SPEECH_START_TIMEOUT_MS + 50)
    expect(onEnd).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(onEnd).toHaveBeenCalledTimes(1) // exactly once
  })

  it('a voice that speaks without onstart gets the estimated duration, not cut off at 3 s', async () => {
    const { synth } = installSpeech({ voices: 1, firesEvents: false })
    synth.speaking = true
    const text = 'word '.repeat(50).trim()
    const onEnd = vi.fn()
    speakText(text, { onEnd, rate: 1 })
    await vi.advanceTimersByTimeAsync(SPEECH_START_TIMEOUT_MS + 100)
    expect(onEnd).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(estimatedSpeechMs(text, 1) + SPEECH_WATCHDOG_MARGIN_MS)
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('a working device voice still ends normally (once)', async () => {
    installSpeech({ voices: 1, firesEvents: true })
    const onEnd = vi.fn()
    const onStart = vi.fn()
    speakText('Hello there.', { onEnd, onStart })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('estimates speech length from the word count and rate', () => {
    expect(estimatedSpeechMs('one two three four five', 1)).toBe(2000)
    expect(estimatedSpeechMs('one two three four five', 0.5)).toBe(4000)
    expect(estimatedSpeechMs('')).toBe(0)
  })
})

describe('cookie notice never covers the interview controls', () => {
  it('is hidden on every /interview page and shown elsewhere', () => {
    for (const p of ['/interview', '/interview/now', '/interview/complete', '/interview/invite/abc']) {
      expect(cookieBannerHiddenOn(p)).toBe(true)
    }
    for (const p of ['/', '/dashboard', '/interviews', '/jobs/x']) expect(cookieBannerHiddenOn(p)).toBe(false)
  })
})

function ev(over: Partial<IntegrityLogEvent>): IntegrityLogEvent {
  return {
    id: Math.random().toString(36),
    eventType: 'NO_FACE_SEEN',
    severity: 'warn',
    message: '',
    timestamp: '2026-11-20T10:00:00Z',
    formattedTime: '',
    startOffsetSec: 0,
    durationSec: 0,
    ...over,
  }
}

describe('proctoring labels and counts', () => {
  it('short events show their real length (2.5s, never "(3s)")', () => {
    expect(formatSpan(2.5)).toBe('2.5s')
    expect(formatSpan(2.96)).toBe('2.9s')
    expect(formatSpan(6)).toBe('6s')
    expect(formatSpan(8.04)).toBe('8s')
    expect(formatSpan(95)).toBe('1m 35s')
    expect(markerTooltip({ label: 'No face', startSec: 4.3, endSec: 6.8, instant: false })).toBe('No face · 00:04 (2.5s)')
  })

  it('the applicant card count is the same number as the timeline bar', () => {
    const logs = [
      ev({ startOffsetSec: 4.3, durationSec: 2.5 }),
      ev({ startOffsetSec: 84.4, durationSec: 8 }),
      ev({ eventType: 'MULTIPLE_FACES_DETECTED', startOffsetSec: 104.6, durationSec: 7.1 }),
      ev({ startOffsetSec: 124.4, durationSec: 2.7 }),
      ev({ eventType: 'TAB_OR_WINDOW_LEFT', startOffsetSec: 175.6, durationSec: 0, severity: 'block' }),
    ]
    const applicant = {
      interviewResult: {
        overall: 40,
        integrity: { logs, proctoring: { counts: { total: 4 }, flaggedSections: [] }, banned: true, cameraOffByChoice: true },
      },
    } as unknown as EmployerApplicant
    const bar = buildTimelineMarkers(logs, [])
    expect(timelineSummary(bar)).toMatch(/^5 deviations/)
    expect(proctorFlagCount(applicant)).toBe(bar.length)
    expect(proctorFlagBreakdown(applicant).join(', ')).toMatch(/No face 3.*Multiple faces 1.*Left tab \/ window 1/)
    expect(proctorNotes(applicant)).toEqual(['Ended early: left the interview tab', 'Camera off by choice'])
  })

  it('falls back to the stored total when no events were kept', () => {
    const applicant = { interviewResult: { integrity: { proctoring: { counts: { total: 2 } } } } } as unknown as EmployerApplicant
    expect(proctorFlagCount(applicant)).toBe(2)
    expect(proctorNotes(applicant)).toEqual([])
  })
})

describe('candidate-facing messages', async () => {
  const m = await import('./candidateMessages')
  const { InterviewLlmError } = await import('./interviewLlmErrors')

  it('never shows developer text when the interview cannot start', () => {
    const dev = new Error(
      'Could not start the interview: connect to the API with GEMINI_API_KEY, or enable dev client LLM (VITE_ALLOW_CLIENT_LLM + VITE_GEMINI_API_KEY).',
    )
    expect(m.candidateStartErrorMessage(dev)).toBe(m.START_FAILED_MESSAGE)
    expect(m.candidateStartErrorMessage(new InterviewLlmError('LLM_QUESTION_FAILED', 'Gemini could not produce a batch'))).toBe(
      m.START_FAILED_MESSAGE,
    )
    expect(m.candidateStartErrorMessage(new TypeError('Failed to fetch'))).toBe(m.OFFLINE_START_MESSAGE)
    // Our own plain-language messages pass through.
    expect(m.candidateStartErrorMessage(new Error('Allow microphone access before joining the interview room.'))).toMatch(
      /microphone/,
    )
    expect(m.START_FAILED_MESSAGE).toMatch(/try again in a minute/)
  })

  it('replaces raw "Failed to fetch" with an offline message', () => {
    expect(m.candidateSyncErrorMessage(new TypeError('Failed to fetch'))).toBe(m.OFFLINE_SYNC_MESSAGE)
    expect(m.candidateSyncErrorMessage(new Error('boom'))).toBe(m.SYNC_RETRY_MESSAGE)
  })

  it('queues an answer sent while offline and confirms when it is saved', async () => {
    let calls = 0
    const send = vi.fn(async () => {
      calls += 1
      if (calls < 3) throw new TypeError('Failed to fetch')
      return 'next question'
    })
    const onOffline = vi.fn()
    const onSaved = vi.fn()
    const out = await m.sendWithReconnect(send, { onOffline, onSaved, waitOnline: async () => {}, retryDelayMs: 0 })
    expect(out).toBe('next question')
    expect(send).toHaveBeenCalledTimes(3)
    expect(onOffline).toHaveBeenCalledTimes(1)
    expect(onSaved).toHaveBeenCalledTimes(1)
    await expect(m.sendWithReconnect(async () => { throw new Error('INTERVIEW_COMPLETE') }, { retryDelayMs: 0 })).rejects.toThrow(
      'INTERVIEW_COMPLETE',
    )
  })
})

describe('completion page headline', async () => {
  const c = await import('./interviewCompleteCopy')
  it('no "Congratulations" for a low or ended interview', () => {
    expect(c.interviewCompleteHeadline({ first: 'Kavya', score: 29, endedEarly: false })).toEqual({ title: 'Interview complete', celebrate: false })
    expect(c.interviewCompleteHeadline({ first: 'Kavya', score: null, endedEarly: false }).title).toBe('Interview complete')
    expect(c.interviewCompleteHeadline({ first: 'Kavya', score: 80, endedEarly: true }).title).toBe('Interview ended early')
    expect(c.interviewCompleteHeadline({ first: 'Kavya', score: 80, endedEarly: false })).toEqual({
      title: 'Congratulations, Kavya!',
      celebrate: true,
    })
  })
  it('says why the interview ended', () => {
    const r = { integrity: { faceViolations: 0, singlePersonOk: false, maxFacesSeen: 1, banned: true, banReason: 'You left the interview tab or minimized the browser.' } }
    expect(c.interviewEndedEarly(r)).toBe(true)
    expect(c.interviewEndedEarlyReason(r)).toMatch(/left the interview tab/)
    expect(c.interviewEndedEarly({ integrity: undefined })).toBe(false)
  })
})
