/**
 * When is the candidate's answer finished? These rules decide how quickly the interview moves on, which is the
 * delay candidates feel most (it used to be a flat 5 seconds of silence after every answer).
 */

/** Silence (ms) after the last words before the answer is submitted. Under 25 words waits 4.5 s, 25 through
 *  60 waits 3 s, and a longer answer waits 2 s. Never below SPEECH_SETTLE_MS. */
export function silenceAdvanceMs(transcript: string): number {
  const words = countWords(transcript)
  const ms = words > 60 ? 2_000 : words >= 25 ? 3_000 : 4_500
  return Math.max(SPEECH_SETTLE_MS, ms)
}

/** A spoken answer needs at least this many words before it can end by itself (fewer is a false start). */
export const MIN_ANSWER_WORDS = 6
/** "…and", "…so", "…because": the candidate is mid-thought, never end the answer there. */
const TRAILING_CONNECTOR_RE = /\b(and|so|because|but|like|or|um+|uh+|then)[\s,.…-]*$/i
/** The visible "Moving on… keep talking to continue" countdown before a voice answer is submitted. */
export const ENDING_COUNTDOWN_MS = 1_500
export const ENDING_COUNTDOWN_LABEL = 'Moving on… keep talking to continue'

export function endsWithConnector(transcript: string): boolean {
  return TRAILING_CONNECTOR_RE.test(transcript.trim())
}

/**
 * Has a spoken answer clearly ended? At least MIN_ANSWER_WORDS words (6), a silence that scales with the answer
 * (4.5 s under 25 words / 3 s for 25 through 60 / 2 s over 60), no trailing connector, and the recogniser is idle.
 */
export function voiceAnswerComplete(input: {
  transcript: string
  lastSpeechAt: number
  now: number
  sttPhase: 'idle' | 'capturing' | 'transcribing'
}): boolean {
  const text = input.transcript.trim()
  if (input.sttPhase !== 'idle' || !input.lastSpeechAt) return false
  if (countWords(text) < MIN_ANSWER_WORDS || endsWithConnector(text)) return false
  return input.now - input.lastSpeechAt >= silenceAdvanceMs(text)
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/** Said at the very end of an answer: move to the next question now. */
const ANSWER_DONE_RE =
  /(?:^|[\s,.;!?])(next question|that'?s my answer|that is my answer|that's it for this (one|question)|move on to the next( one| question)?|let'?s move on|skip (this|the) question|skip question)[\s.!?]*$/i
/** A reply that is nothing but "skip" / "pass" (a bare "skip" at the end of a real answer is not a command). */
const SKIP_ONLY_RE = /^(ok(ay)?[,.]?\s+)?(please\s+)?(skip|pass)( (it|this|this one))?(,?\s*please)?[.!]*$/i

/** If the transcript ends with a "next question" command, the answer without it; otherwise null. */
export function answerDoneCommand(transcript: string): string | null {
  const text = transcript.trim()
  if (SKIP_ONLY_RE.test(text)) return ''
  const match = text.match(ANSWER_DONE_RE)
  if (!match || match.index === undefined) return null
  return text.slice(0, match.index).replace(/[\s,;]+$/, '').trim()
}

/** The answer with any trailing "next question" command removed (what gets saved and scored). */
export function stripAnswerDoneCommand(transcript: string): string {
  const cleaned = answerDoneCommand(transcript)
  return cleaned === null ? transcript.trim() : cleaned
}

function echoWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9+#]+/)
    .filter(Boolean)
}

/**
 * The microphone often opens with the tail of Ava's question ("…design a rate limiter") stuck to the front of
 * the candidate's answer. Drop that leading fragment when it is only the end of her question. A transcript that
 * is nothing but that echo comes back empty, so the caller does not save it as an answer.
 */
export function stripEchoOfQuestion(transcript: string, questionText: string): string {
  const raw = transcript.trim()
  const question = questionText.trim()
  if (!raw || !question) return raw
  const qWords = echoWords(question)
  const parts = raw.split(/\s+/)
  const tWords = parts.map((part) => echoWords(part)[0] || '')
  if (!qWords.length || !tWords.some(Boolean)) return raw
  const max = Math.min(parts.length, qWords.length)
  let drop = 0
  for (let n = max; n >= 2; n -= 1) {
    const lead = tWords.slice(0, n)
    if (lead.some((word) => !word)) continue
    const tail = qWords.slice(qWords.length - n)
    if (lead.every((word, i) => word === tail[i])) {
      drop = n
      break
    }
  }
  if (!drop) return raw
  if (drop >= parts.length) return ''
  return parts.slice(drop).join(' ').replace(/^[,.;:!?]+/, '').trim()
}

const EXPLICIT_END_RE = /\b(end (the |this )?interview|stop (the |this )?interview|finish (the |this )?interview|no more questions)\b/i
const SHORT_END_RE = /^(ok(ay)?[,.]?\s+)?(i'?m done|i am done|that'?s all|that is all)[.!]*$/i

/**
 * The candidate wants to END THE WHOLE INTERVIEW. Only an explicit phrase in the last words, or a short reply that
 * is nothing but "I'm done" / "that's all". (It used to match those words anywhere, so an answer containing
 * "...and that's all I handled there" ended the interview.)
 */
export function isEndInterviewRequest(transcript: string): boolean {
  const text = transcript.trim()
  if (!text) return false
  const words = text.split(/\s+/)
  const tail = words.slice(-8).join(' ')
  if (EXPLICIT_END_RE.test(tail)) return true
  return words.length <= 5 && SHORT_END_RE.test(text)
}

/**
 * Owner rule: the interview never jumps to the next question until the answer is said. A question moves on only
 * when (a) the candidate finished answering (speech ended, then a short silence) or pressed "Submit answer",
 * (b) the candidate skipped it ("Skip question" button, or said "next question" / "skip"), or (c) the 3:00 answer
 * time fully ran out (that clock starts only after Ava has finished asking).
 *
 * Silence never advances. After SILENCE_NUDGE_MS of quiet Ava gives one gentle nudge and keeps listening; near the
 * end of the time limit there is at most one more ("About 30 seconds left").
 */
export const SILENCE_NUDGE_MS = 18_000
/** Spoken by Ava (and shown) after a long silence. She keeps listening afterwards. */
export const SILENCE_NUDGE_PROMPT =
  'Take your time. When you’re ready, answer — or say “next question”, or click Skip, to move on.'
/** Seconds left on the answer clock when the second (last) nudge is given. */
export const TIME_LEFT_NUDGE_SEC = 30
export const TIME_LEFT_NUDGE_PROMPT = 'About 30 seconds left.'
/** Nothing advances (and Ava does not speak) within this long after the candidate's last words. */
export const SPEECH_SETTLE_MS = 2_000
/**
 * The 3:00 ran out while speech recognition is still "capturing" or "transcribing" and there is no transcription
 * promise in flight. Wait this long so a real last sentence can land, then move on anyway. A hung phase with no
 * promise must not keep the same question on screen. An in-flight promise uses TRANSCRIPT_JOIN_MS instead.
 */
export const STUCK_STT_GRACE_MS = 4_000
/** How long submit / voice-complete / said-next / time-up waits for an in-flight Moonshine transcription. */
export const TRANSCRIPT_JOIN_MS = 12_000
/** A capture that never ends (VAD never fires speech-end) is abandoned so the candidate can type or the clock can move on. */
export const CAPTURE_STUCK_MS = 20_000
/** Text shorter than this is a false start ("um", "okay"), not yet an answer. */
export const MIN_ANSWER_CHARS = 10
/** What Ava SAYS for the silence nudge: the screen shows SILENCE_NUDGE_PROMPT. The spoken line leaves out the
 *  literal "next question" so the microphone (kept on during the nudge) cannot hear Ava give the command. */
export const SILENCE_NUDGE_SPOKEN = 'Take your time. When you’re ready, answer, or use the skip button to move on.'

/** Why a question moved on; sent with the saved answer so skips can be diagnosed. */
export type AdvanceReason = 'submit' | 'voice-complete' | 'said-next' | 'skip' | 'time-up' | 'end'
export const ADVANCE_REASONS: readonly AdvanceReason[] = ['submit', 'voice-complete', 'said-next', 'skip', 'time-up', 'end']

/**
 * Saves the answer before the question moves on: up to `attempts` tries, each with a `timeoutMs` limit. Resolves
 * false when it could not be saved (the caller stays on the question and offers Retry); never advances silently.
 */
export async function saveAnswerBeforeAdvance(
  save: () => Promise<boolean>,
  opts: { attempts?: number; timeoutMs?: number; retryDelayMs?: number } = {},
): Promise<boolean> {
  const attempts = opts.attempts ?? 2
  for (let i = 0; i < attempts; i++) {
    const ok = await Promise.race([
      save().catch(() => false),
      new Promise<boolean>((r) => setTimeout(() => r(false), opts.timeoutMs ?? 5_000)),
    ])
    if (ok) return true
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, opts.retryDelayMs ?? 800))
  }
  return false
}

export type AnswerTickInput = {
  now: number
  /** Live transcript of the answer so far. */
  transcript: string
  sttPhase: 'idle' | 'capturing' | 'transcribing'
  /** Last time speech was heard (0 = never during this question). */
  lastSpeechAt: number
  /** When Ava finished asking the question, i.e. the listening window opened (0 = still asking). */
  answerWindowStartedAt: number
  /** The silence nudge was already given for this question. */
  nudged: boolean
  /** Seconds left on the answer clock (omit when unknown). */
  secondsLeft?: number
  /** The "about 30 seconds left" nudge was already given for this question. */
  timeNudged?: boolean
  /** When the "Moving on…" countdown started (0 / omitted = not running). */
  countdownStartedAt?: number
  /** Ignore spoken commands (Ava is saying a nudge; her own words must not count as "next question"). */
  commandsMuted?: boolean
}

export type AnswerTickDecision =
  | 'wait'
  | 'submit-now'
  | 'start-countdown'
  | 'cancel-countdown'
  | 'submit'
  | 'nudge'
  | 'time-nudge'

/**
 * What the answer loop should do on this tick:
 * - 'submit-now': the candidate said "next question" / "that's my answer" / "skip" (recogniser idle).
 * - 'start-countdown': a voice answer looks complete (voiceAnswerComplete): show the 1.5 s ENDING_COUNTDOWN_LABEL.
 * - 'cancel-countdown': the candidate spoke again during the countdown: keep listening.
 * - 'submit': the countdown ran out with no new speech: submit the voice answer.
 * - 'nudge': SILENCE_NUDGE_MS of quiet and no answer yet: Ava nudges once and keeps listening.
 * - 'time-nudge': TIME_LEFT_NUDGE_SEC left and the candidate is quiet: Ava says TIME_LEFT_NUDGE_PROMPT.
 * - 'wait': keep listening. Silence alone never moves on.
 */
export function decideAnswerTick(input: AnswerTickInput): AnswerTickDecision {
  // No listening window yet (Ava still asking, or her voice failed and the watchdog has not opened it): nothing.
  if (!input.answerWindowStartedAt) return 'wait'
  const busy = input.sttPhase === 'capturing' || input.sttPhase === 'transcribing'
  const text = input.transcript.trim()
  const sinceSpeech = input.lastSpeechAt ? input.now - input.lastSpeechAt : Number.POSITIVE_INFINITY
  if (text && answerDoneCommand(text) !== null && !busy && !input.commandsMuted) return 'submit-now'
  const complete = voiceAnswerComplete({ transcript: text, lastSpeechAt: input.lastSpeechAt, now: input.now, sttPhase: input.sttPhase })
  if (input.countdownStartedAt) {
    if (!complete || input.lastSpeechAt > input.countdownStartedAt) return 'cancel-countdown'
    return input.now - input.countdownStartedAt >= ENDING_COUNTDOWN_MS ? 'submit' : 'wait'
  }
  if (busy || sinceSpeech < SPEECH_SETTLE_MS) return 'wait'
  if (complete) return 'start-countdown'
  if (
    typeof input.secondsLeft === 'number' &&
    input.secondsLeft > 0 &&
    input.secondsLeft <= TIME_LEFT_NUDGE_SEC &&
    !input.timeNudged
  ) {
    return 'time-nudge'
  }
  // A real answer in progress (thinking pause, trailing "and…") is never nudged; only "no answer yet" is.
  if (countWords(text) >= MIN_ANSWER_WORDS) return 'wait'
  // The quiet clock starts when the question ends and restarts on any speech.
  const quietSince = Math.max(input.answerWindowStartedAt, input.lastSpeechAt || 0)
  if (input.now - quietSince >= SILENCE_NUDGE_MS && !input.nudged) return 'nudge'
  return 'wait'
}

/**
 * The 3:00 ran out: move on, but not within SPEECH_SETTLE_MS of their last words, and not if no listening window
 * was opened. A capturing/transcribing phase with no transcription promise that lasts past STUCK_STT_GRACE_MS
 * still moves on. While a promise is in flight this returns false; the caller submits into TRANSCRIPT_JOIN_MS.
 */
export function timeUpCanAdvance(input: {
  now: number
  lastSpeechAt: number
  sttPhase: 'idle' | 'capturing' | 'transcribing'
  answerWindowStartedAt: number
  /** When the current capturing/transcribing phase started. Omit when idle. */
  phaseSince?: number
  /** Moonshine transcribeAudio is still running. The 4 s grace does not apply. */
  transcribeInFlight?: boolean
}): boolean {
  if (!input.answerWindowStartedAt) return false
  if (input.transcribeInFlight) return false
  const quiet = !input.lastSpeechAt || input.now - input.lastSpeechAt >= SPEECH_SETTLE_MS
  if (input.sttPhase === 'idle') return quiet
  const since = input.phaseSince || input.lastSpeechAt
  if (!since) return true
  return quiet && input.now - since >= STUCK_STT_GRACE_MS
}

/**
 * The last turn ("Thank you for your time today…") is a goodbye, not a question: it gets no "Question N" label, no
 * answer timer and no listening window; the interview finishes once Ava has said it.
 */
export function isClosingStatement(q: { focus?: string | null } | null | undefined): boolean {
  const focus = String(q?.focus ?? '')
  return focus === 'structured-closing' || focus === 'pending-closing'
}

/** The question the 400ms tick and the answer clock must read: the live list, at the live index. */
export function questionAtTick<T>(questions: readonly T[] | null | undefined, index: number): T | undefined {
  if (!questions || index < 0 || index >= questions.length) return undefined
  return questions[index]
}

/**
 * True when the question now at this index is a goodbye. The tick must not nudge and the answer clock must not run.
 * Callers pass the list they hold now (a ref), not the list captured when the interval started.
 */
export function isClosingQuestionAt(
  questions: readonly { focus?: string | null }[] | null | undefined,
  index: number,
): boolean {
  return isClosingStatement(questionAtTick(questions, index))
}

/**
 * The 3:00 answer clock runs only while the answer window is open: it starts when Ava has finished asking (so a
 * slow or stuck voice never eats the candidate's time) and it never runs for the closing line.
 */
export function answerClockRunning(input: { answerWindowStartedAt: number; aiSpeaking: boolean; closing: boolean }): boolean {
  return !input.closing && !input.aiSpeaking && input.answerWindowStartedAt > 0
}
