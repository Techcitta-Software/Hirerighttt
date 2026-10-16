/**
 * HireRight Interview Agent Client
 * Synchronized with Google Gemini AI (gemini-2.5-flash).
 * Generates interactive, resume-tailored questions and rubric scoring.
 */
import type { Question } from './interviewEngine'
import type { AnswerAnalysis, IntegrityLogEvent, InterviewResult, SavedProfile } from './store'
import { apiFetch } from './api'
import { ensureApiSession } from './apiSession'
import { clientLlmAllowed } from './clientLlm'
import { candidateFullName } from './store'
import { generateLocalAdaptiveQuestion, INTERVIEW_TURN_COUNT } from './adaptiveInterview'
import { generateAdaptiveQuestionClient } from './interviewQuestionGeneration'
import {
  buildResumeInterviewQuestions,
  runLocalInterviewScore,
} from './localInterview'

function enrichProfileForAgent(profile: SavedProfile | null): SavedProfile | null {
  if (!profile) return null
  const display = candidateFullName()
  const resolved =
    profile.fullName?.trim() ||
    profile.name?.trim() ||
    (display && display !== 'Candidate' ? display : '')
  if (!resolved) return profile
  return {
    ...profile,
    fullName: resolved,
    name: resolved,
  }
}

function candidateFirstName(profile: SavedProfile | null): string {
  const full =
    profile?.fullName?.trim() ||
    profile?.name?.trim() ||
    candidateFullName()
  if (!full || full === 'Candidate') return 'there'
  return full.split(/\s+/)[0] || 'there'
}

const GEMINI_API_KEY = clientLlmAllowed()
  ? import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.VITE_OPENAI_API_KEY || ''
  : ''
const GEMINI_BASE_URL = (
  typeof window !== 'undefined' && clientLlmAllowed()
    ? '/ai-proxy'
    : import.meta.env.VITE_GEMINI_BASE_URL ||
      import.meta.env.VITE_OPENAI_BASE_URL ||
      'https://generativelanguage.googleapis.com/v1beta/openai'
).replace(/\/$/, '')
const PRIMARY_MODEL =
  import.meta.env.VITE_PRIMARY_MODEL || 'gemini-2.5-flash'
const FALLBACK_MODEL =
  import.meta.env.VITE_FALLBACK_MODEL || 'gemini-1.5-flash'
const GEMINI_MODEL = PRIMARY_MODEL

export type InterviewStartResponse = {
  sessionId: string | null
  agent: string
  llm: boolean
  total: number
  questions: Question[]
  question: Question
  offline?: boolean
  adaptive?: boolean
}

export type JobLinkedInterviewMeta = {
  applicationId?: string
  jobId?: string
  organizationId?: string
}

export type IntegritySnapshot = {
  faceViolations: number
  singlePersonOk: boolean
  maxFacesSeen: number
  banned?: boolean
  banReason?: string
  sideLookWarnings?: number
  tooFarWarnings?: number
  logs?: IntegrityLogEvent[]
}

/** Check whether Gemini is live and operational */
export async function checkLlmStatus(): Promise<{
  active: boolean
  model: string
  provider: string
  message: string
}> {
  // 1. First check if backend server is reporting status
  try {
    const res = await fetch('/api/llm-status')
    if (res.ok) {
      const data = await res.json()
      if (data.active) return data
    }
  } catch {
    // backend offline, check direct API
  }

  // 2. Direct ping to AI gateway (development only)
  if (!clientLlmAllowed() || !GEMINI_API_KEY) {
    return {
      active: false,
      model: 'server-api',
      provider: 'HireRight API',
      message: 'Use the Node API for LLM in production (or set VITE_GEMINI_API_KEY).',
    }
  }

  const models = [PRIMARY_MODEL, FALLBACK_MODEL]
  for (const m of models) {
    try {
      const directRes = await fetch(`${GEMINI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GEMINI_API_KEY}`,
          'x-goog-api-key': GEMINI_API_KEY,
        },
        body: JSON.stringify({
          model: m,
          messages: [{ role: 'user', content: 'Ping' }],
          max_tokens: 5,
        }),
      })

      if (directRes.ok) {
        return {
          active: true,
          model: m,
          provider: 'Google Gemini',
          message: `Google Gemini (${m}) is LIVE and calibrated with candidate profile.`,
        }
      }
    } catch {
      // try next model
    }
  }

  return {
    active: false,
    model: 'local-agent',
    provider: 'Local Resume Agent',
    message: 'Running in local resume-matching mode.',
  }
}

/**
 * Start an interview session with Ava.
 * Tries Google Gemini AI, falling back smoothly to local resume questions.
 */
export async function startInterviewSession(
  role: string,
  level: string,
  profile: SavedProfile | null,
  jobDescription?: string,
  explicitRoleTrack?: boolean,
): Promise<InterviewStartResponse> {
  const agentProfile = enrichProfileForAgent(profile)
  await ensureApiSession()

  // 1. Try backend server if running
  try {
    const res = await apiFetch('/api/interview/start', {
      method: 'POST',
      body: JSON.stringify({
        role,
        level,
        profile: agentProfile,
        jobDescription,
        adaptive: true,
        explicitRoleTrack: Boolean(explicitRoleTrack),
      }),
    })
    if (res.ok) {
      const data = await res.json()
      const adaptive = data.adaptive !== false && Boolean(data.adaptive ?? data.mode === 'adaptive')
      const questions = data.questions
      const hasQuestions =
        Array.isArray(questions) &&
        (adaptive ? questions.length >= 1 : questions.length >= 3)
      if (hasQuestions) {
        const llmAgent = data.agent === 'llm' || data.llm || data.agent === 'llm-adaptive'
        const totalTurns =
          typeof data.total === 'number' && data.total > 0
            ? data.total
            : adaptive
              ? INTERVIEW_TURN_COUNT
              : questions.length
        return {
          sessionId: data.sessionId || `session-${Date.now().toString(36)}`,
          agent: llmAgent
            ? 'Ava · Google Gemini · adaptive'
            : data.agent || 'Ava · adaptive agent',
          llm: Boolean(llmAgent),
          total: totalTurns,
          questions,
          question: questions[0],
          offline: false,
          adaptive,
        }
      }
    }
  } catch {
    // backend not running, proceed to direct Gemini call
  }

  // 2. Direct adaptive question (one LLM call — same spec as server)
  if (clientLlmAllowed()) {
    const firstLlm = await generateAdaptiveQuestionClient({
      profile: agentProfile,
      role,
      level,
      jobDescription,
      history: [],
      lastAnswer: '',
    })
    if (firstLlm) {
      return {
        sessionId: `gemini-${Date.now().toString(36)}`,
        agent: 'Ava · adaptive LLM (client)',
        llm: true,
        total: INTERVIEW_TURN_COUNT,
        questions: [firstLlm],
        question: firstLlm,
        offline: true,
        adaptive: true,
      }
    }
  }

  // 3. Local template fallback (one question at a time)
  const firstAdaptive = generateLocalAdaptiveQuestion(
    role,
    level,
    agentProfile,
    [],
    '',
    { explicitRoleTrack, jobDescription },
  )
  return {
    sessionId: `local-${Date.now().toString(36)}`,
    agent: 'Ava · local adaptive agent',
    llm: false,
    total: INTERVIEW_TURN_COUNT,
    questions: [firstAdaptive],
    question: firstAdaptive,
    offline: true,
    adaptive: true,
  }
}

export async function pingInterviewIntegrity(
  sessionId: string | null,
  faceCount: number,
): Promise<void> {
  if (!sessionId) return
  try {
    await apiFetch('/api/interview/integrity', {
      method: 'POST',
      body: JSON.stringify({ sessionId, faceCount }),
    })
  } catch {
    // client-side integrity still applies
  }
}

export type InterviewTurnResponse = {
  spoken: string
  interactive?: boolean
  agent?: string
}

/** Ava acknowledges the answer and bridges to the next question (interactive agent). */
export async function processInterviewTurn(options: {
  sessionId: string | null
  role: string
  level: string
  question: Question
  answer: string
  questionIndex: number
  totalQuestions: number
  nextQuestion?: Question
  profile: SavedProfile | null
}): Promise<InterviewTurnResponse> {
  await ensureApiSession()
  const agentProfile = enrichProfileForAgent(options.profile)
  const first = candidateFirstName(agentProfile)
  const fallback = (words: number) => {
    if (words < 8) {
      return `Thanks ${first}. Add a concrete example from your resume when you can — let's continue. `
    }
    if (words < 22) {
      return `Thanks ${first}, I appreciate that. Let's go deeper on the next one. `
    }
    return `Great, ${first} — that helps. Let's move on. `
  }
  const wordCount = options.answer.trim().split(/\s+/).filter(Boolean).length

  try {
    const res = await apiFetch('/api/interview/turn', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: options.sessionId,
        role: options.role,
        level: options.level,
        profile: agentProfile,
        question: options.question,
        answer: options.answer,
        questionIndex: options.questionIndex,
        totalQuestions: options.totalQuestions,
        nextQuestion: options.nextQuestion,
      }),
    })
    if (res.ok) {
      const data = (await res.json()) as InterviewTurnResponse
      if (data.spoken?.trim()) return data
    }
  } catch {
    // local fallback
  }

  return { spoken: fallback(wordCount), interactive: false, agent: 'local-bridge' }
}

/**
 * Score interview responses with Google Gemini AI (gemini-2.5-flash)
 */
async function scoreWithGeminiDirect(options: {
  role: string
  level: string
  questions: Question[]
  answers: string[]
  profile: SavedProfile | null
  integrity: IntegritySnapshot
}): Promise<InterviewResult | null> {
  if (!GEMINI_API_KEY) return null

  const qas = options.questions.map((q, i) => ({
    questionNumber: i + 1,
    questionText: q.text,
    category: q.category,
    candidateAnswer: options.answers[i] || '(No response provided)',
    resumeAnchor: q.resumeAnchor || 'General experience',
  }))

  const system = `You are Ava, HireRight's chief AI assessment evaluator powered by Google Gemini.
Evaluate the candidate's interview responses against their resume, technical depth, STAR structure, clarity, and the target role: ${options.role} (${options.level}).

Scoring Standards:
- Score 90-100: Exceptional, concrete metrics, clear architecture/tools, direct resume alignment.
- Score 75-89: Solid answers with good technical depth and clear examples.
- Score 50-74: Basic response with limited detail or missing outcomes.
- Score <50: Incomplete, evasive, or missing answers.

Return ONLY valid JSON matching this schema:
{
  "overall": 85,
  "categories": [
    {"label": "Technical", "score": 88},
    {"label": "Communication", "score": 82},
    {"label": "Problem Solving", "score": 86},
    {"label": "Experience", "score": 84}
  ],
  "strengths": ["...", "...", "..."],
  "improvements": ["...", "..."],
  "resumeFitScore": 88,
  "feedback": "Comprehensive summary evaluation of candidate's technical capability...",
  "answerFeedback": [
    {"score": 88, "feedback": "..."},
    {"score": 82, "feedback": "..."}
  ]
}`

  const user = JSON.stringify({
    role: options.role,
    level: options.level,
    candidateFirstName: candidateFirstName(options.profile),
    candidateFullName:
      options.profile?.fullName ||
      options.profile?.name ||
      candidateFullName() ||
      'Candidate',
    resumeSkills: options.profile?.skills || [],
    qas,
  })

  try {
    const res = await fetch(`${GEMINI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GEMINI_API_KEY}`,
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
      }),
    })

    if (!res.ok) return null
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || ''
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) return null

    const parsed = JSON.parse(match[0])
    const overall = typeof parsed.overall === 'number' ? parsed.overall : 80

    const categories = Array.isArray(parsed.categories) && parsed.categories.length === 4
      ? parsed.categories
      : [
          { label: 'Communication', score: overall },
          { label: 'Technical', score: overall },
          { label: 'Problem Solving', score: overall },
          { label: 'Experience', score: overall },
        ]

    const strengths = Array.isArray(parsed.strengths) ? parsed.strengths.map(String) : []
    const improvements = Array.isArray(parsed.improvements) ? parsed.improvements.map(String) : []

    const answers: AnswerAnalysis[] = options.questions.map((q, i) => {
      const fb = parsed.answerFeedback?.[i]
      const answerText = options.answers[i] || ''
      return {
        question: q.text,
        answer: answerText,
        score: typeof fb?.score === 'number' ? fb.score : overall,
        wordCount: answerText.split(/\s+/).filter(Boolean).length,
        keywordsHit: q.keywords.filter((k) => answerText.toLowerCase().includes(k.toLowerCase())),
        feedback: fb?.feedback || (answerText.length > 20 ? 'Solid response provided.' : 'Too brief.'),
      }
    })

    return {
      role: options.role,
      level: options.level,
      date: new Date().toISOString(),
      overall,
      categories,
      strengths: strengths.slice(0, 5),
      improvements: improvements.slice(0, 5),
      answers,
      resumeFitScore: typeof parsed.resumeFitScore === 'number' ? parsed.resumeFitScore : overall,
      agent: 'Ava · Google Gemini 2.5 Flash',
      integrity: {
        faceViolations: options.integrity.faceViolations || 0,
        singlePersonOk: options.integrity.singlePersonOk !== false,
        maxFacesSeen: options.integrity.maxFacesSeen || 1,
        banned: options.integrity.banned,
        banReason: options.integrity.banReason,
        sideLookWarnings: options.integrity.sideLookWarnings,
        tooFarWarnings: options.integrity.tooFarWarnings,
        logs: options.integrity.logs,
      },
    }
  } catch (err) {
    console.warn('[scoreWithGeminiDirect] Error:', err)
    return null
  }
}

/**
 * Score full interview remotely or with direct Google Gemini.
 */
export async function scoreInterviewRemote(options: {
  sessionId: string | null
  role: string
  level: string
  questions: Question[]
  answers: string[]
  profile: SavedProfile | null
  integrity: IntegritySnapshot
}): Promise<InterviewResult> {
  const agentProfile = enrichProfileForAgent(options.profile)
  await ensureApiSession()

  // 1. Backend scoring (resume agent + optional LLM refine)
  try {
    const res = await apiFetch('/api/interview/score', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: options.sessionId,
        role: options.role,
        level: options.level,
        questions: options.questions,
        answers: options.answers,
        profile: agentProfile,
        integrity: options.integrity,
      }),
    })
    if (res.ok) {
      const data = await res.json()
      if (data.interview) {
        return data.interview as InterviewResult
      }
    }
  } catch {
    // continue to Gemini / local
  }

  // 2. Direct Gemini scoring — dev only
  if (clientLlmAllowed()) {
    try {
      const scored = await scoreWithGeminiDirect({ ...options, profile: agentProfile })
      if (scored) return scored
    } catch (err) {
      console.warn('[scoreInterviewRemote] Direct score error, falling back to local score:', err)
    }
  }

  // 3. Local interview scoring
  return runLocalInterviewScore({ ...options, profile: agentProfile })
}

/** @deprecated use buildResumeInterviewQuestions */
export function buildLocalResumeQuestions(
  role: string,
  level: string,
  profile: SavedProfile | null,
  jobDescription?: string,
): Question[] {
  return buildResumeInterviewQuestions(role, level, profile, jobDescription)
}
