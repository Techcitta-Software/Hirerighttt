import type { Question } from './interviewEngine'
import type { SavedProfile } from './store'
import { apiFetch } from './api'
import { ensureApiSession } from './apiSession'
import { candidateFullName } from './store'

import {
  generateAdaptiveQuestionClient,
  generateAdaptiveQuestionLocal,
  INTERVIEW_TURN_COUNT,
} from './interviewQuestionGeneration'

export { INTERVIEW_TURN_COUNT }
export const MIN_ANSWERS_BEFORE_END = 2
/** Matches server `INTERVIEW_TURN_COUNT` / `question-generation.md`. */
export const MAX_ADAPTIVE_QUESTIONS = INTERVIEW_TURN_COUNT

const END_INTERVIEW_RE =
  /\b(end (the )?interview|stop (the )?interview|finish (the )?interview|i'?m done|that'?s all|no more questions)\b/i

export function isEndInterviewCommand(text: string): boolean {
  return END_INTERVIEW_RE.test(text.trim())
}

export { extractClaimedSkills } from './interviewQuestionGeneration'

/** Same rules as the server when Gemini is not configured. */
export function generateLocalAdaptiveQuestion(
  role: string,
  level: string,
  profile: SavedProfile | null,
  history: { question: Question; answer: string }[],
  lastAnswer: string,
  options?: { explicitRoleTrack?: boolean; jobDescription?: string },
): Question {
  return generateAdaptiveQuestionLocal({
    profile,
    role,
    level,
    jobDescription: options?.jobDescription,
    history,
    lastAnswer,
  })
}

export async function fetchNextAdaptiveQuestion(options: {
  sessionId: string | null
  role: string
  level: string
  profile: SavedProfile | null
  jobDescription?: string
  explicitRoleTrack?: boolean
  history: { question: Question; answer: string }[]
  lastQuestion: Question
  lastAnswer: string
}): Promise<Question> {
  await ensureApiSession()
  try {
    const res = await apiFetch('/api/interview/next', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: options.sessionId,
        role: options.role,
        level: options.level,
        profile: options.profile,
        jobDescription: options.jobDescription,
        explicitRoleTrack: options.explicitRoleTrack,
        history: options.history.slice(0, -1),
        lastQuestion: options.lastQuestion,
        lastAnswer: options.lastAnswer,
      }),
    })
    if (res.ok) {
      const data = await res.json()
      if (data.question?.text) return data.question as Question
    }
  } catch {
    // client LLM / local fallback
  }

  return generateAdaptiveQuestionClient({
    profile: options.profile,
    role: options.role,
    level: options.level,
    jobDescription: options.jobDescription,
    history: options.history,
    lastAnswer: options.lastAnswer,
  })
}

export function enrichProfileName(profile: SavedProfile | null): SavedProfile | null {
  if (!profile) return null
  const display = candidateFullName()
  if (!display || display === 'Candidate') return profile
  return { ...profile, fullName: display, name: display }
}
