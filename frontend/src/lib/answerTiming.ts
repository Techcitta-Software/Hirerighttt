/**
 * When is the candidate's answer finished? These rules decide how quickly the interview moves on, which is the
 * delay candidates feel most (it used to be a flat 5 seconds of silence after every answer).
 */

/** Silence (ms) after the last words before the answer is submitted. A long answer that has clearly landed
 *  moves on sooner; a short one gets the full pause, because the candidate may still be thinking. */
export function silenceAdvanceMs(transcript: string): number {
  const words = countWords(transcript)
  if (words >= 45) return 2800
  if (words >= 20) return 3800
  return 5000
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/** Said at the very end of an answer: move to the next question now. */
const ANSWER_DONE_RE =
  /(?:^|[\s,.;!?])(next question|that'?s my answer|that is my answer|that's it for this (one|question)|move on to the next( one| question)?|let'?s move on)[\s.!?]*$/i

/** If the transcript ends with a "next question" command, the answer without it; otherwise null. */
export function answerDoneCommand(transcript: string): string | null {
  const text = transcript.trim()
  const match = text.match(ANSWER_DONE_RE)
  if (!match || match.index === undefined) return null
  return text.slice(0, match.index).replace(/[\s,;]+$/, '').trim()
}

/** The answer with any trailing "next question" command removed (what gets saved and scored). */
export function stripAnswerDoneCommand(transcript: string): string {
  const cleaned = answerDoneCommand(transcript)
  return cleaned === null ? transcript.trim() : cleaned
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
 * No answer at all: how long Ava waits after she finishes the question before treating it as unanswered. Any speech
 * (even a few words, or sound the recogniser is still transcribing) restarts this clock, so a candidate who pauses
 * to think mid-answer is never cut off by it.
 */
export const NO_ANSWER_TIMEOUT_MS = 18_000
/** After Ava says the "no answer" line, how long the notice stays before the next question. */
export const NO_ANSWER_NOTICE_HOLD_MS = 3_000
/** Longest the move-on waits for the "no answer" line to finish playing (a stuck audio callback never blocks). */
export const NO_ANSWER_SPEECH_MAX_MS = 9_000
/** Spoken by Ava and shown as text when the candidate has not answered. */
export const NO_ANSWER_PROMPT = 'I haven’t heard an answer, so we’ll move on to the next question.'
/** Text shorter than this is a false start ("um", "okay"), not yet an answer. */
export const MIN_ANSWER_CHARS = 10

export type AnswerTickInput = {
  now: number
  /** Live transcript of the answer so far. */
  transcript: string
  sttPhase: 'idle' | 'capturing' | 'transcribing'
  /** Last time speech was heard (0 = never during this question). */
  lastSpeechAt: number
  /** When Ava finished asking the question (0 = still asking). */
  answerWindowStartedAt: number
  /** The no-answer prompt already ran for this question. */
  noAnswerHandled: boolean
}

/**
 * What the answer loop should do on this tick:
 * - 'submit-now': the candidate said "next question".
 * - 'submit': the answer has landed (silence after it, see silenceAdvanceMs).
 * - 'no-answer': nothing was said for NO_ANSWER_TIMEOUT_MS after the question: Ava says NO_ANSWER_PROMPT, then moves on.
 * - 'wait': keep listening.
 */
export function decideAnswerTick(input: AnswerTickInput): 'wait' | 'submit-now' | 'submit' | 'no-answer' {
  const text = input.transcript.trim()
  if (text && answerDoneCommand(text) !== null) return 'submit-now'
  if (text.length >= MIN_ANSWER_CHARS) {
    if (!input.lastSpeechAt) return 'wait'
    return input.now - input.lastSpeechAt >= silenceAdvanceMs(text) ? 'submit' : 'wait'
  }
  if (input.sttPhase === 'capturing' || input.sttPhase === 'transcribing') return 'wait'
  if (!input.answerWindowStartedAt) return 'wait'
  // The clock starts when the question ends and restarts on any speech (a mid-answer pause never counts as no answer).
  const quietSince = Math.max(input.answerWindowStartedAt, input.lastSpeechAt || 0)
  if (input.now - quietSince < NO_ANSWER_TIMEOUT_MS) return 'wait'
  if (text.length > 0 || input.lastSpeechAt > input.answerWindowStartedAt) {
    // They said something short ("yes", "I think...") and then stayed quiet: save it and move on, no "no answer" line.
    return 'submit'
  }
  return input.noAnswerHandled ? 'wait' : 'no-answer'
}
