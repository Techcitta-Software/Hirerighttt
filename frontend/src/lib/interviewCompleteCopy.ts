import type { InterviewResult } from './store'

/** Scores at or above this get a "Congratulations"; below it the page stays neutral. */
export const CONGRATULATE_FROM_SCORE = 50

export function interviewEndedEarly(result: Pick<InterviewResult, 'endedEarly' | 'integrity'> | null | undefined): boolean {
  return Boolean(result?.endedEarly || result?.integrity?.endedEarly || result?.integrity?.banned)
}

/** Why the interview ended, in the candidate's words (shown on the completion page). */
export function interviewEndedEarlyReason(result: Pick<InterviewResult, 'integrity'> | null | undefined): string {
  const reason = String(result?.integrity?.banReason || result?.integrity?.endedEarlyReason || '').trim()
  return reason || 'You left the interview tab, so the interview ended. Your answers so far were scored.'
}

/**
 * The completion page headline. "Congratulations" only for a finished interview with a good score; an interview
 * that ended early, or a low or not-yet-known score, gets a neutral headline.
 */
export function interviewCompleteHeadline(input: { first: string; score: number | null; endedEarly: boolean }): {
  title: string
  celebrate: boolean
} {
  if (input.endedEarly) return { title: 'Interview ended early', celebrate: false }
  if (input.score != null && input.score >= CONGRATULATE_FROM_SCORE) {
    return { title: input.first ? `Congratulations, ${input.first}!` : 'Congratulations!', celebrate: true }
  }
  return { title: 'Interview complete', celebrate: false }
}
