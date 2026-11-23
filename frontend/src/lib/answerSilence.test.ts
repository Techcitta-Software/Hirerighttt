import { describe, expect, it } from 'vitest'
import {
  NO_ANSWER_NOTICE_HOLD_MS,
  NO_ANSWER_PROMPT,
  NO_ANSWER_TIMEOUT_MS,
  decideAnswerTick,
  type AnswerTickInput,
} from './answerTiming'

const ASKED_AT = 1_000_000

function tick(over: Partial<AnswerTickInput>): ReturnType<typeof decideAnswerTick> {
  return decideAnswerTick({
    now: ASKED_AT,
    transcript: '',
    sttPhase: 'idle',
    lastSpeechAt: 0,
    answerWindowStartedAt: ASKED_AT,
    noAnswerHandled: false,
    ...over,
  })
}

describe('no answer after the question', () => {
  it('gives the candidate meaningfully more time than the old 5-10 s', () => {
    expect(NO_ANSWER_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000)
    expect(NO_ANSWER_TIMEOUT_MS).toBeLessThanOrEqual(20_000)
    expect(tick({ now: ASKED_AT + 10_000 })).toBe('wait')
    expect(tick({ now: ASKED_AT + NO_ANSWER_TIMEOUT_MS - 1 })).toBe('wait')
  })

  it('then asks Ava to say the no-answer line (once), which holds ~3 s before moving on', () => {
    expect(tick({ now: ASKED_AT + NO_ANSWER_TIMEOUT_MS })).toBe('no-answer')
    expect(tick({ now: ASKED_AT + NO_ANSWER_TIMEOUT_MS + 5_000, noAnswerHandled: true })).toBe('wait')
    expect(NO_ANSWER_PROMPT).toMatch(/haven.t heard an answer/i)
    expect(NO_ANSWER_PROMPT).toMatch(/next question/i)
    expect(NO_ANSWER_NOTICE_HOLD_MS).toBe(3_000)
  })

  it('never starts the clock while Ava is still asking the question', () => {
    expect(tick({ answerWindowStartedAt: 0, now: ASKED_AT + 60_000 })).toBe('wait')
  })

  it('does not fire while speech is being captured or transcribed', () => {
    const now = ASKED_AT + NO_ANSWER_TIMEOUT_MS + 1_000
    expect(tick({ now, sttPhase: 'capturing' })).toBe('wait')
    expect(tick({ now, sttPhase: 'transcribing' })).toBe('wait')
  })
})

describe('mid-answer pauses never trigger the no-answer prompt', () => {
  it('any speech restarts the quiet clock', () => {
    const spokeAt = ASKED_AT + 12_000
    // 18 s after the question, but only 6 s after the candidate last spoke: keep waiting.
    expect(tick({ now: ASKED_AT + NO_ANSWER_TIMEOUT_MS, lastSpeechAt: spokeAt })).toBe('wait')
  })

  it('a long thinking pause inside a real answer just ends the answer normally', () => {
    const transcript = 'I would start by profiling the slow query and then'
    // 4 s pause: still talking (short answers get the full 5 s).
    expect(tick({ transcript, lastSpeechAt: ASKED_AT + 20_000, now: ASKED_AT + 24_000 })).toBe('wait')
    // Silence after a real answer submits it; it is never reported as "no answer".
    expect(tick({ transcript, lastSpeechAt: ASKED_AT + 20_000, now: ASKED_AT + 40_000 })).toBe('submit')
  })

  it('a short false start followed by long silence is saved as the answer, without the no-answer line', () => {
    expect(tick({ transcript: 'um okay', lastSpeechAt: ASKED_AT + 2_000, now: ASKED_AT + 2_000 + NO_ANSWER_TIMEOUT_MS })).toBe(
      'submit',
    )
    expect(tick({ transcript: 'um okay', lastSpeechAt: ASKED_AT + 2_000, now: ASKED_AT + 10_000 })).toBe('wait')
  })

  it('"next question" still moves on immediately', () => {
    expect(tick({ transcript: 'that is my answer next question', lastSpeechAt: ASKED_AT + 1_000, now: ASKED_AT + 1_100 })).toBe(
      'submit-now',
    )
  })
})
