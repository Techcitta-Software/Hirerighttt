import type { Question } from './interviewEngine'

import type { SavedProfile } from './store'

import { apiFetch } from './api'

import { ensureApiSession } from './apiSession'

import { clientLlmAllowed } from './clientLlm'

import { geminiChatFetch, parseGeminiChatResponse } from './geminiAuth'

import { candidateFullName } from './store'



export const PROFESSIONAL_INTERVIEW_LENGTH = 6

export const MIN_ANSWERS_BEFORE_END = 2

export const MAX_ADAPTIVE_QUESTIONS = PROFESSIONAL_INTERVIEW_LENGTH



const DEMO_NAME = 'Arjun Sharma'



const END_INTERVIEW_RE =

  /\b(end (the )?interview|stop (the )?interview|finish (the )?interview|i'?m done|that'?s all|no more questions)\b/i



export function isEndInterviewCommand(text: string): boolean {

  return END_INTERVIEW_RE.test(text.trim())

}



export {

  isNextQuestionCommand,

  isAffirmativeResponse,

  isRepeatQuestionCommand,

  isRepeatLastCommand,

  isSpeakSlowerCommand,

} from './interviewInteractive'



const CATEGORIES = ['Communication', 'Technical', 'Problem Solving', 'Experience'] as const



const GEMINI_API_KEY = clientLlmAllowed()

  ? import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.VITE_OPENAI_API_KEY || ''

  : ''

const GEMINI_BASE = (

  typeof window !== 'undefined' && clientLlmAllowed()

    ? '/ai-proxy'

    : import.meta.env.VITE_GEMINI_BASE_URL ||

      'https://generativelanguage.googleapis.com/v1beta/openai'

).replace(/\/$/, '')

const GEMINI_MODEL = import.meta.env.VITE_PRIMARY_MODEL || 'gemini-3.5-flash-lite'



function profileFirstName(profile: SavedProfile | null): string {

  const full = candidateFullName()

  if (!full || full === 'Candidate' || full === DEMO_NAME || /^arjun\s+sharma$/i.test(full)) {

    return 'there'

  }

  if (profile?.fullName && !/^arjun\s+sharma$/i.test(profile.fullName)) {

    return profile.fullName.split(/\s+/)[0] || 'there'

  }

  return full.split(/\s+/)[0] || 'there'

}



function normalizeQuestion(raw: Record<string, unknown>, priorTexts: string[]): Question | null {

  const text = String(raw.text || '').trim()

  if (text.length < 24) return null

  if (priorTexts.some((p) => p === text || p.slice(0, 40) === text.slice(0, 40))) return null

  const categoryRaw = String(raw.category || 'Technical')

  const category = CATEGORIES.includes(categoryRaw as (typeof CATEGORIES)[number])

    ? (categoryRaw as Question['category'])

    : 'Technical'

  const keywords = Array.isArray(raw.keywords)

    ? raw.keywords.map((k) => String(k).toLowerCase()).filter(Boolean).slice(0, 12)

    : ['experience', 'project', 'result']

  return {

    text,

    category,

    keywords,

    hint: String(raw.hint || 'Give a concrete example with tools and outcome.'),

    topic: String(raw.topic || category),

    resumeAnchor: raw.resumeAnchor ? String(raw.resumeAnchor) : undefined,

    focus: 'adaptive-llm-client',

  }

}



async function generateAdaptiveQuestionViaClientLlm(input: {

  role: string

  level: string

  profile: SavedProfile | null

  history: { question: Question; answer: string }[]

  lastAnswer: string

  jobDescription?: string

}): Promise<Question | null> {

  if (!GEMINI_API_KEY) return null



  const first = profileFirstName(input.profile)

  const turn = input.history.length + 1

  const priorTexts = input.history.map((h) => h.question.text)

  const resumeSnippet = (input.profile?.resumeText || '').slice(0, 2800)

  const skills = (input.profile?.skills || []).slice(0, 16)

  const jobs = (input.profile?.workExperiences || [])

    .filter((w) => w.jobTitle || w.company)

    .slice(0, 6)

    .map((w) => `${w.jobTitle || 'Role'} @ ${w.company || 'Company'}`)



  const system = `You are Ava, a realistic professional interviewer. Generate exactly ONE interview question as JSON only.

- Question ${turn} of ${PROFESSIONAL_INTERVIEW_LENGTH}. Do not repeat prior questions.

- Role: ${input.role}, experience: ${input.level}.

- ${first === 'there' ? 'Do not use placeholder names (no Arjun). Use "you" or neutral phrasing.' : `You may address "${first}" once if natural.`}

- Base on resume when provided; do not invent facts.

Return: {"question":{"text":"...","category":"Communication|Technical|Problem Solving|Experience","keywords":["..."],"hint":"...","topic":"..."}}`



  const user = JSON.stringify({

    turnNumber: turn,

    jobDescription: input.jobDescription || null,

    skills,

    jobs,

    resumeSnippet,

    priorQuestions: priorTexts,

    lastAnswer: input.lastAnswer || null,

  })



  try {

    const res = await geminiChatFetch({

      apiKey: GEMINI_API_KEY,

      openAiBaseUrl: GEMINI_BASE,

      model: GEMINI_MODEL,

      system,

      user,

      temperature: 0.55,

    })

    if (!res.ok) return null

    const data = await res.json()

    const content = parseGeminiChatResponse(data)

    const match = content.match(/\{[\s\S]*\}/)

    if (!match) return null

    const parsed = JSON.parse(match[0]) as { question?: Record<string, unknown> }

    return normalizeQuestion(parsed.question || (parsed as Record<string, unknown>), priorTexts)

  } catch {

    return null

  }

}



/** Client fallback — AI only (dev with VITE_GEMINI_API_KEY). */

export async function generateLocalAdaptiveQuestion(

  role: string,

  level: string,

  profile: SavedProfile | null,

  history: { question: Question; answer: string }[],

  lastAnswer: string,

  options?: { explicitRoleTrack?: boolean; jobDescription?: string },

): Promise<Question> {

  const ai = await generateAdaptiveQuestionViaClientLlm({

    role,

    level,

    profile,

    history,

    lastAnswer,

    jobDescription: options?.jobDescription,

  })

  if (ai) return ai

  throw new Error(

    'AI interview requires Gemini. Set GEMINI_API_KEY on the server, or VITE_GEMINI_API_KEY for local dev.',

  )

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

    if (res.status === 503) {

      const data = await res.json().catch(() => ({}))

      throw new Error(data.error || 'AI question generation unavailable on server.')

    }

  } catch (err) {

    if (err instanceof Error && err.message.includes('AI')) throw err

  }



  return generateLocalAdaptiveQuestion(

    options.role,

    options.level,

    options.profile,

    options.history,

    options.lastAnswer,

    {

      explicitRoleTrack: options.explicitRoleTrack,

      jobDescription: options.jobDescription,

    },

  )

}



export function enrichProfileName(profile: SavedProfile | null): SavedProfile | null {

  if (!profile) return null

  const display = candidateFullName()

  if (!display || display === 'Candidate' || display === DEMO_NAME) return profile

  return { ...profile, fullName: display, name: display }

}


