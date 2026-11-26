import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TARGET_JOB_BACKUP_KEY,
  TARGET_JOB_TTL_MS,
  clearTargetJob,
  readTargetJob,
  writeTargetJob,
} from './targetJob'
import {
  INVITE_BACKUP_KEY,
  formatSlotCountdown,
  inviteAccessFromStored,
  markImmediateInterview,
  msUntilSlotOpens,
  persistScheduledInvite,
  readStoredInterviewInvite,
  storeBookingLock,
} from './interviewInviteGate'
import {
  enterPreparedSession,
  invalidateLobbySessionPrep,
  resumePointFromStart,
  type LobbySessionPrepPayload,
} from './interviewLobbySessionPrep'
import type { InterviewStartResponse } from './interviewAgentClient'
import { storeApplyResumeFile } from './resumeUploadApi'

const JOB = { title: 'Backend Engineer', company: 'Acme', role: 'Backend Engineer', level: '3-5', jobId: 'job-1', applicationId: 'app-1' }

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  }
}

/** A closed tab = sessionStorage gone, localStorage kept. */
function closeTab() {
  vi.stubGlobal('sessionStorage', memoryStorage())
}

beforeEach(() => {
  vi.stubGlobal('sessionStorage', memoryStorage())
  vi.stubGlobal('localStorage', memoryStorage())
  localStorage.setItem('hireright.session', 'cand@example.com')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  invalidateLobbySessionPrep()
})

describe('job context survives closing the tab (T5 B10)', () => {
  it('reopening /interview in a new tab keeps the same job', () => {
    writeTargetJob(JOB)
    closeTab()
    expect(readTargetJob()?.applicationId).toBe('app-1')
  })

  it('expires, and never carries over to another account', () => {
    vi.useFakeTimers()
    writeTargetJob(JOB)
    closeTab()
    localStorage.setItem('hireright.session', 'someone@else.com')
    expect(readTargetJob()).toBeNull()

    localStorage.setItem('hireright.session', 'cand@example.com')
    writeTargetJob(JOB)
    closeTab()
    vi.setSystemTime(Date.now() + TARGET_JOB_TTL_MS + 1000)
    expect(readTargetJob()).toBeNull()
    expect(localStorage.getItem(TARGET_JOB_BACKUP_KEY)).toBeNull()
  })

  it('clearing removes both copies', () => {
    writeTargetJob(JOB)
    clearTargetJob()
    closeTab()
    expect(readTargetJob()).toBeNull()
  })
})

describe('booked slot lock (T1)', () => {
  const start = Date.parse('2026-11-27T04:30:00Z')
  const slot = { token: 't', scheduledStart: new Date(start).toISOString(), scheduledEnd: new Date(start + 15 * 60_000).toISOString() }

  it('a self-booked slot stays locked in a new tab, a recruiter link is not copied', () => {
    vi.useFakeTimers()
    vi.setSystemTime(start - 3600_000)
    persistScheduledInvite(slot, { survivesNewTab: true })
    closeTab()
    expect(inviteAccessFromStored(readStoredInterviewInvite())?.status).toBe('too_early')

    localStorage.removeItem(INVITE_BACKUP_KEY)
    persistScheduledInvite(slot)
    closeTab()
    expect(readStoredInterviewInvite()).toBeNull()
  })

  it('"take it now" and an ended slot drop the lock', () => {
    vi.useFakeTimers()
    vi.setSystemTime(start - 3600_000)
    persistScheduledInvite(slot, { survivesNewTab: true })
    markImmediateInterview()
    closeTab()
    expect(readStoredInterviewInvite()).toBeNull()

    persistScheduledInvite(slot, { survivesNewTab: true })
    closeTab()
    vi.setSystemTime(start + 16 * 60_000)
    expect(readStoredInterviewInvite()).toBeNull()
  })

  it('stores a server booking with the server clock offset and shows a real countdown', () => {
    const now = start - (2 * 3600_000 + 5 * 60_000)
    const serverNow = new Date(now + 60_000).toISOString() // device one minute slow
    expect(storeBookingLock({ ...slot, status: 'too_early' }, serverNow, now)).toBe(true)
    const stored = readStoredInterviewInvite()
    expect(stored?.serverOffsetMs).toBe(60_000)
    expect(formatSlotCountdown(msUntilSlotOpens(stored, now)!)).toBe('2 h 04 min')
    expect(formatSlotCountdown(4 * 60_000 + 9_000)).toBe('4:09')
    expect(formatSlotCountdown(-5)).toBe('0:00')
    expect(formatSlotCountdown(3 * 86_400_000 + 2 * 3600_000)).toBe('3 d 2 h')
  })
})

function payload(started: Partial<InterviewStartResponse>): LobbySessionPrepPayload {
  return {
    started: { sessionId: 'abc123', agent: 'x', llm: true, total: 6, questions: [], question: { text: '' }, ...started } as InterviewStartResponse,
    targetJob: null,
    mergedProfile: null,
    context: {} as LobbySessionPrepPayload['context'],
  }
}

describe('reload mid-interview resumes (T5 B9)', () => {
  const questions = [0, 1, 2, 3].map((i) => ({ text: `Question ${i} long enough for the room` }))

  it('a new interview starts at question 0', () => {
    expect(resumePointFromStart(payload({ questions }).started)).toEqual({ current: 0, answers: [], history: [] })
  })

  it('a resumed one continues at the first unanswered question with the saved answers', () => {
    const point = resumePointFromStart(
      payload({
        questions,
        resumed: true,
        questionIndex: 2,
        answers: ['a0', 'a1'],
        history: [
          { question: questions[0], answer: 'a0' },
          { question: questions[1], answer: 'a1' },
        ],
      }).started,
    )
    expect(point.current).toBe(2)
    expect(point.answers).toEqual(['a0', 'a1'])
    expect(point.history).toHaveLength(2)
  })

  it('entering claims the session; an expired prepared session is prepared again once', async () => {
    const enter = vi.fn().mockResolvedValueOnce(undefined)
    const again = vi.fn()
    const p = payload({ questions })
    await expect(enterPreparedSession(p, again, enter)).resolves.toBe(p)
    expect(enter).toHaveBeenCalledWith('abc123')
    expect(again).not.toHaveBeenCalled()

    const expired = Object.assign(new Error('expired'), { name: 'SESSION_EXPIRED' })
    const fresh = payload({ sessionId: 'fresh1', questions })
    const enter2 = vi.fn().mockRejectedValueOnce(expired).mockResolvedValueOnce(undefined)
    await expect(enterPreparedSession(p, async () => fresh, enter2)).resolves.toBe(fresh)
    expect(enter2).toHaveBeenLastCalledWith('fresh1')
  })

  it('a payment-required entry is surfaced, never silently retried', async () => {
    const pay = Object.assign(new Error('pay'), { name: 'RetakePaymentRequiredError' })
    const again = vi.fn()
    await expect(enterPreparedSession(payload({ questions }), again, vi.fn().mockRejectedValue(pay))).rejects.toBe(pay)
    expect(again).not.toHaveBeenCalled()
  })

  it('offline sessions are not entered on the server', async () => {
    const enter = vi.fn()
    await enterPreparedSession(payload({ sessionId: 'session-abc', offline: true }), vi.fn(), enter)
    expect(enter).not.toHaveBeenCalled()
  })
})

describe('job-apply resume file is stored (T5 B14)', () => {
  it('uploads the file like onboarding and never blocks the application on failure', async () => {
    const file = new File(['%PDF'], 'cv.pdf', { type: 'application/pdf' })
    const ok = vi.fn().mockResolvedValue({ ok: true, result: { resumeStoragePath: 'users/u/resume/cv.pdf', resumeUrl: '/api/resume/download' } })
    expect((await storeApplyResumeFile(file, ok))?.resumeStoragePath).toBe('users/u/resume/cv.pdf')
    expect(ok).toHaveBeenCalledWith(file, { background: true })
    expect(await storeApplyResumeFile(file, vi.fn().mockResolvedValue({ ok: false, error: 'down' }))).toBeNull()
    expect(await storeApplyResumeFile(file, vi.fn().mockRejectedValue(new Error('net')))).toBeNull()
    expect(await storeApplyResumeFile(null, ok)).toBeNull()
  })
})
