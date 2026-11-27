/**
 * Owner rule: the interview never jumps to the next question until the answer is said. Silence only nudges; a
 * question moves on after an answer, a skip, or the full answer time (which starts after Ava finishes asking).
 */
import { describe, expect, it } from 'vitest'
import {
  ADVANCE_REASONS,
  ENDING_COUNTDOWN_LABEL,
  ENDING_COUNTDOWN_MS,
  MIN_ANSWER_WORDS,
  SILENCE_NUDGE_SPOKEN,
  countWords,
  endsWithConnector,
  saveAnswerBeforeAdvance,
  voiceAnswerComplete,
  SILENCE_NUDGE_MS,
  SILENCE_NUDGE_PROMPT,
  SPEECH_SETTLE_MS,
  TIME_LEFT_NUDGE_PROMPT,
  TIME_LEFT_NUDGE_SEC,
  answerClockRunning,
  answerDoneCommand,
  decideAnswerTick,
  isClosingStatement,
  timeUpCanAdvance,
  type AnswerTickInput,
} from './answerTiming'

const ASKED_AT = 1_000_000
const ADVANCES = new Set(['submit', 'submit-now'])

function tick(over: Partial<AnswerTickInput>): ReturnType<typeof decideAnswerTick> {
  return decideAnswerTick({
    now: ASKED_AT,
    transcript: '',
    sttPhase: 'idle',
    lastSpeechAt: 0,
    answerWindowStartedAt: ASKED_AT,
    nudged: false,
    ...over,
  })
}

describe('silence never advances the question', () => {
  it('waits quietly, then nudges once after ~18 s and keeps listening', () => {
    expect(SILENCE_NUDGE_MS).toBeGreaterThanOrEqual(15_000)
    expect(tick({ now: ASKED_AT + 10_000 })).toBe('wait')
    expect(tick({ now: ASKED_AT + SILENCE_NUDGE_MS - 1 })).toBe('wait')
    expect(tick({ now: ASKED_AT + SILENCE_NUDGE_MS })).toBe('nudge')
    expect(SILENCE_NUDGE_PROMPT).toMatch(/take your time/i)
    expect(SILENCE_NUDGE_PROMPT).toMatch(/next question/i)
    expect(SILENCE_NUDGE_PROMPT).toMatch(/skip/i)
  })

  it('after the nudge, even minutes of silence never submit', () => {
    for (const after of [20_000, 60_000, 120_000, 179_000]) {
      const d = tick({ now: ASKED_AT + after, nudged: true, timeNudged: true, secondsLeft: 1 })
      expect(ADVANCES.has(d)).toBe(false)
    }
  })

  it('a short false start ("um okay") followed by silence is not treated as an answer', () => {
    const d = tick({ transcript: 'um okay', lastSpeechAt: ASKED_AT + 2_000, now: ASKED_AT + 2_000 + SILENCE_NUDGE_MS })
    expect(d).toBe('nudge')
    expect(tick({ transcript: 'um okay', lastSpeechAt: ASKED_AT + 2_000, now: ASKED_AT + 60_000, nudged: true })).toBe('wait')
  })

  it('gives at most one "about 30 seconds left" nudge near the end of the time limit', () => {
    expect(TIME_LEFT_NUDGE_PROMPT).toMatch(/30 seconds/i)
    expect(tick({ now: ASKED_AT + 150_000, nudged: true, secondsLeft: TIME_LEFT_NUDGE_SEC })).toBe('time-nudge')
    expect(tick({ now: ASKED_AT + 151_000, nudged: true, secondsLeft: 29, timeNudged: true })).toBe('wait')
    expect(tick({ now: ASKED_AT + 100_000, nudged: true, secondsLeft: 80 })).toBe('wait')
  })
})

describe('no listening window, no advance (the Q3-skip bug)', () => {
  it('nothing happens until Ava has finished asking', () => {
    expect(tick({ answerWindowStartedAt: 0, now: ASKED_AT + 600_000 })).toBe('wait')
    expect(tick({ answerWindowStartedAt: 0, transcript: 'next question', lastSpeechAt: ASKED_AT })).toBe('wait')
    expect(
      timeUpCanAdvance({ now: ASKED_AT + 600_000, lastSpeechAt: 0, sttPhase: 'idle', answerWindowStartedAt: 0 }),
    ).toBe(false)
  })
})

describe('a question advances only on an answer, a skip, or the time running out', () => {
  it('a real voice answer ends only after a silence, then a 1.5 s "keep talking" countdown', () => {
    const transcript = 'I would start by profiling the slow query and then add an index on the filter column'
    const spoke = ASKED_AT + 20_000
    expect(tick({ transcript, lastSpeechAt: spoke, now: spoke + 1_000 })).toBe('wait')
    expect(tick({ transcript, lastSpeechAt: spoke, now: spoke + 4_400 })).toBe('wait') // under 25 words: 4.5 s
    expect(tick({ transcript, lastSpeechAt: spoke, now: spoke + 4_500 })).toBe('start-countdown')
    const cd = spoke + 4_500
    expect(tick({ transcript, lastSpeechAt: spoke, now: cd + 1_000, countdownStartedAt: cd })).toBe('wait')
    expect(tick({ transcript, lastSpeechAt: spoke, now: cd + ENDING_COUNTDOWN_MS, countdownStartedAt: cd })).toBe('submit')
    // Any speech during the countdown cancels it.
    expect(tick({ transcript, lastSpeechAt: cd + 500, now: cd + 2_000, countdownStartedAt: cd })).toBe('cancel-countdown')
    expect(tick({ transcript, lastSpeechAt: spoke, now: cd + 1_000, countdownStartedAt: cd, sttPhase: 'capturing' })).toBe(
      'cancel-countdown',
    )
  })

  it('false starts never end the answer: under 6 words, or a trailing "and / so / because / like"', () => {
    const spoke = ASKED_AT + 5_000
    const few = 'I think the main thing'
    expect(countWords(few)).toBeLessThan(MIN_ANSWER_WORDS)
    expect(tick({ transcript: few, lastSpeechAt: spoke, now: spoke + 60_000, nudged: true })).toBe('wait')
    for (const tail of ['and', 'so', 'because', 'like', 'but um']) {
      const t = `I would start by profiling the slow query and then add an index ${tail}`
      expect(voiceAnswerComplete({ transcript: t, lastSpeechAt: spoke, now: spoke + 60_000, sttPhase: 'idle' })).toBe(false)
    }
    expect(endsWithConnector('we shipped it on time.')).toBe(false)
    expect(ENDING_COUNTDOWN_LABEL).toMatch(/keep talking/i)
  })

  it('long answers end sooner (2 s) and medium ones after 3 s', () => {
    const long = Array.from({ length: 70 }, (_, i) => `w${i}`).join(' ')
    const medium = Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ')
    const spoke = ASKED_AT + 5_000
    expect(tick({ transcript: long, lastSpeechAt: spoke, now: spoke + 2_000 })).toBe('start-countdown')
    expect(tick({ transcript: medium, lastSpeechAt: spoke, now: spoke + 2_900 })).toBe('wait')
    expect(tick({ transcript: medium, lastSpeechAt: spoke, now: spoke + 3_000 })).toBe('start-countdown')
  })

  it('Ava saying a nudge can never trigger a spoken command (mic stays on during the nudge)', () => {
    expect(tick({ transcript: 'next question', lastSpeechAt: ASKED_AT + 1_000, now: ASKED_AT + 1_100, commandsMuted: true })).not.toBe(
      'submit-now',
    )
    expect(SILENCE_NUDGE_SPOKEN).not.toMatch(/next question/i)
    expect(answerDoneCommand(SILENCE_NUDGE_SPOKEN)).toBeNull()
  })

  it('saves the answer before advancing; a failed save never advances', async () => {
    expect(await saveAnswerBeforeAdvance(async () => true)).toBe(true)
    let n = 0
    expect(await saveAnswerBeforeAdvance(async () => ++n >= 2, { retryDelayMs: 0 })).toBe(true)
    expect(await saveAnswerBeforeAdvance(async () => false, { retryDelayMs: 0 })).toBe(false)
    expect(
      await saveAnswerBeforeAdvance(async () => { throw new TypeError('Failed to fetch') }, { retryDelayMs: 0 }),
    ).toBe(false)
    expect(await saveAnswerBeforeAdvance(() => new Promise<boolean>(() => {}), { timeoutMs: 20, attempts: 1 })).toBe(false)
    expect(ADVANCE_REASONS).toEqual(['submit', 'voice-complete', 'said-next', 'skip', 'time-up', 'end'])
  })

  it('never while the candidate is speaking or within ~2 s of their last words', () => {
    const transcript = 'I would start by profiling the slow query and then add an index'
    const now = ASKED_AT + 60_000
    expect(tick({ transcript, lastSpeechAt: now - 100_000, now, sttPhase: 'capturing' })).toBe('wait')
    expect(tick({ transcript, lastSpeechAt: now - 100_000, now, sttPhase: 'transcribing' })).toBe('wait')
    expect(tick({ transcript, lastSpeechAt: now - (SPEECH_SETTLE_MS - 1), now })).toBe('wait')
    expect(timeUpCanAdvance({ now, lastSpeechAt: now - 500, sttPhase: 'idle', answerWindowStartedAt: ASKED_AT })).toBe(false)
    expect(
      timeUpCanAdvance({
        now,
        lastSpeechAt: 0,
        sttPhase: 'capturing',
        answerWindowStartedAt: ASKED_AT,
        phaseSince: now,
      }),
    ).toBe(false)
  })

  it('a typed answer waits for "Submit answer" (no auto-submit on keyboard silence)', () => {
    expect(tick({ transcript: 'A typed answer about indexes', now: ASKED_AT + 120_000, nudged: true })).toBe('wait')
  })

  it('saying "next question" or "skip" moves on immediately', () => {
    expect(tick({ transcript: 'that is my answer next question', lastSpeechAt: ASKED_AT + 1_000, now: ASKED_AT + 1_100 })).toBe(
      'submit-now',
    )
    expect(tick({ transcript: 'skip', lastSpeechAt: ASKED_AT + 1_000, now: ASKED_AT + 1_100 })).toBe('submit-now')
    expect(answerDoneCommand('Skip this question.')).toBe('')
    expect(answerDoneCommand('please skip')).toBe('')
    // A real answer that happens to end with "skip" is not a command.
    expect(answerDoneCommand('In that sprint we decided which tests to skip')).toBeNull()
  })

  it('the time limit advances once it has fully run out and the candidate is quiet', () => {
    expect(
      timeUpCanAdvance({ now: ASKED_AT + 181_000, lastSpeechAt: 0, sttPhase: 'idle', answerWindowStartedAt: ASKED_AT }),
    ).toBe(true)
    expect(
      timeUpCanAdvance({ now: ASKED_AT + 181_000, lastSpeechAt: ASKED_AT + 170_000, sttPhase: 'idle', answerWindowStartedAt: ASKED_AT }),
    ).toBe(true)
    const stuckAt = ASKED_AT + 181_000
    expect(
      timeUpCanAdvance({
        now: stuckAt,
        lastSpeechAt: stuckAt - 10_000,
        sttPhase: 'transcribing',
        answerWindowStartedAt: ASKED_AT,
        phaseSince: stuckAt - 5_000,
      }),
    ).toBe(true)
    expect(
      timeUpCanAdvance({
        now: stuckAt,
        lastSpeechAt: stuckAt - 10_000,
        sttPhase: 'transcribing',
        answerWindowStartedAt: ASKED_AT,
        phaseSince: stuckAt - 5_000,
        transcribeInFlight: true,
      }),
    ).toBe(false)
    expect(
      timeUpCanAdvance({
        now: stuckAt,
        lastSpeechAt: stuckAt - 10_000,
        sttPhase: 'transcribing',
        answerWindowStartedAt: ASKED_AT,
        phaseSince: stuckAt - 1_000,
      }),
    ).toBe(false)
  })
})

describe('the 3:00 answer clock', () => {
  it('starts only after Ava has finished speaking', () => {
    expect(answerClockRunning({ answerWindowStartedAt: 0, aiSpeaking: true, closing: false })).toBe(false)
    expect(answerClockRunning({ answerWindowStartedAt: 0, aiSpeaking: false, closing: false })).toBe(false)
    expect(answerClockRunning({ answerWindowStartedAt: ASKED_AT, aiSpeaking: true, closing: false })).toBe(false)
    expect(answerClockRunning({ answerWindowStartedAt: ASKED_AT, aiSpeaking: false, closing: false })).toBe(true)
  })

  it('never runs for the closing goodbye, which is not a question', () => {
    expect(answerClockRunning({ answerWindowStartedAt: ASKED_AT, aiSpeaking: false, closing: true })).toBe(false)
    expect(isClosingStatement({ focus: 'structured-closing' })).toBe(true)
    expect(isClosingStatement({ focus: 'pending-closing' })).toBe(true)
    expect(isClosingStatement({ focus: 'structured-theory-2' })).toBe(false)
    expect(isClosingStatement(undefined)).toBe(false)
  })
})
