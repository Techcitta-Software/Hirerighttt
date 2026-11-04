import type { Question } from './interviewEngine'
import type { SavedProfile } from './store'
import { apiFetch } from './api'
import { ensureApiSession } from './apiSession'
import { candidateFullName } from './store'
import { clientLlmAllowed } from './clientLlm'

import {
  generateAdaptiveQuestionClient,
  INTERVIEW_TURN_COUNT,
  resolveInterviewTotalTurns,
  summarizeProfileForQuestions,
} from './interviewQuestionGeneration'
import { PENDING_CLOSING_FOCUS, PENDING_FALLBACK_FOCUS } from './interviewQuestionPlan'
import {
  InterviewLlmError,
  interviewLlmGenerationFailedError,
  interviewLlmRequiredError,
} from './interviewLlmErrors'

export { INTERVIEW_TURN_COUNT, PENDING_FALLBACK_FOCUS, PENDING_CLOSING_FOCUS }
export const MIN_ANSWERS_BEFORE_END = 2
export const MAX_ADAPTIVE_QUESTIONS = INTERVIEW_TURN_COUNT

export function isPendingFallbackQuestion(q: Question | undefined): boolean {
  return q?.focus === PENDING_FALLBACK_FOCUS
}

export function isPendingClosingQuestion(q: Question | undefined): boolean {
  return q?.focus === PENDING_CLOSING_FOCUS
}

/** Fallback and closing are generated via /next after prior answers (experienced flow). */
export function isDeferredAdaptiveQuestion(q: Question | undefined): boolean {
  return isPendingFallbackQuestion(q) || isPendingClosingQuestion(q)
}

export function isPreloadedInterviewQuestion(q: Question | undefined): boolean {
  return Boolean(q?.text && q.text.trim().length >= 24)
}

const END_INTERVIEW_RE =
  /\b(end (the )?interview|stop (the )?interview|finish (the )?interview|i'?m done|that'?s all|no more questions)\b/i

export function isEndInterviewCommand(text: string): boolean {
  return END_INTERVIEW_RE.test(text.trim())
}

export { extractClaimedSkills } from './interviewQuestionGeneration'

export async function fetchNextAdaptiveQuestion(options: {
  sessionId: string | null
  role: string
  level: string
  profile: SavedProfile | null
  jobDescription?: string
  explicitRoleTrack?: boolean
  totalTurns?: number
  history: { question: Question; answer: string }[]
  lastQuestion: Question
  lastAnswer: string
  varietySeed?: string
}): Promise<Question> {
  const maxTurns =
    options.totalTurns ??
    resolveInterviewTotalTurns(
      options.profile,
      options.level,
      summarizeProfileForQuestions(options.profile),
      options.role,
    )
  if (options.history.length >= maxTurns) {
    throw new Error('INTERVIEW_COMPLETE')
  }
  const varietySeed =
    options.varietySeed?.trim() ||
    (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().slice(0, 16) : String(Date.now()))

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
        varietySeed,
      }),
    })
    const data = (await res.json().catch(() => ({}))) as {
      complete?: boolean
      question?: Question
      error?: string
      code?: string
    }
    if (res.status === 503 && data.code?.startsWith('LLM_QUESTION')) {
      throw interviewLlmRequiredError(data.error || data.code)
    }
    if (res.ok) {
      if (data.complete === true) throw new Error('INTERVIEW_COMPLETE')
      if (data.question?.text && data.question.text.length >= 24) {
        return data.question
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'INTERVIEW_COMPLETE') throw err
    if (err instanceof InterviewLlmError) throw err
  }

  if (clientLlmAllowed()) {
    return generateAdaptiveQuestionClient({
      profile: options.profile,
      role: options.role,
      level: options.level,
      jobDescription: options.jobDescription,
      history: options.history,
      lastAnswer: options.lastAnswer,
      varietySeed,
    })
  }

  throw interviewLlmGenerationFailedError()
}

export function enrichProfileName(profile: SavedProfile | null): SavedProfile | null {
  if (!profile) return null
  const display = candidateFullName()
  if (!display || display === 'Candidate') return profile
  return { ...profile, fullName: display, name: display }
}
