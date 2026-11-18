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
