/**
 * HireRight Interview Agent Client
 * Client-side Gemini helpers (default gemini-3.1-flash-lite; server is source of truth for interviews).
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
const GEMINI_FLASH_LITE =
  import.meta.env.VITE_PRIMARY_MODEL || 'gemini-3.1-flash-lite'
const GEMINI_MODEL = GEMINI_FLASH_LITE

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
  /** Sent to API on score; processed into integrity.proctoring server-side. */
  flaggedSections?: import('./store').InterviewFlagSection[]
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

  try {
    const directRes = await fetch(`${GEMINI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GEMINI_API_KEY}`,
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify({
        model: GEMINI_FLASH_LITE,
        messages: [{ role: 'user', content: 'Ping' }],
        max_tokens: 5,
      }),
    })

    if (directRes.ok) {
      return {
        active: true,
        model: GEMINI_FLASH_LITE,
        provider: 'Google Gemini',
        message: `Google Gemini (${GEMINI_FLASH_LITE}) is LIVE and calibrated with candidate profile.`,
      }
    }
  } catch {
    // direct ping failed
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
export type InterviewStartOptions = {
  jobDescription?: string
  explicitRoleTrack?: boolean
  jobId?: string
  applicationId?: string
  organizationId?: string
  questionMode?: 'employer' | 'individual_jd' | 'resume_only' | 'vendor_jd'
  primarySkills?: string[]
  atsScore?: number
  jdMatchScore?: number
}

const INTERVIEW_START_TIMEOUT_MS = 90_000

/** Client-generated ids (offline fallbacks) have no server session to sync review events or recordings to. */
export function isServerInterviewSession(sessionId: string | null | undefined): sessionId is string {
  return Boolean(sessionId) && !/^(local|gemini|session)-/.test(sessionId!)
}

export async function startInterviewSession(
  role: string,
  level: string,
  profile: SavedProfile | null,
  options?: InterviewStartOptions | string,
  explicitRoleTrackLegacy?: boolean,
): Promise<InterviewStartResponse> {
  const opts: InterviewStartOptions =
    typeof options === 'string'
      ? { jobDescription: options, explicitRoleTrack: explicitRoleTrackLegacy }
      : options || {}
  const jobDescription = opts.jobDescription
  const explicitRoleTrack = opts.explicitRoleTrack
  const isVendorJob = Boolean(opts.jobId || opts.applicationId)
  const agentProfile = enrichProfileForAgent(profile)
  await ensureApiSession()

  // 1. Try backend server if running
  try {
    const res = await apiFetch('/api/interview/start', {
      method: 'POST',
      // LLM question generation + session save can outlast apiFetch's default timeout; aborting
      // early drops the candidate into an offline session that cannot save review events or video.
      signal: AbortSignal.timeout(INTERVIEW_START_TIMEOUT_MS),
      body: JSON.stringify({
        role,
        level,
        profile: agentProfile,
        jobDescription,
        adaptive: true,
        explicitRoleTrack: Boolean(explicitRoleTrack),
        jobId: opts.jobId,
        applicationId: opts.applicationId,
        organizationId: opts.organizationId,
        questionMode: opts.questionMode,
        primarySkills: opts.primarySkills,
        atsScore: opts.atsScore,
        jdMatchScore: opts.jdMatchScore,
      }),
    })
    const data = await res.json().catch(() => ({} as Record<string, unknown>))
    if (res.ok) {
      const adaptive = data.adaptive !== false && Boolean(data.adaptive ?? data.mode === 'adaptive')
      const questions = data.questions as Question[] | undefined
      const hasQuestions =
        Array.isArray(questions) &&
        (adaptive ? questions.length >= 1 : questions.length >= 3)
      if (hasQuestions) {
        const llmAgent =
          data.agent === 'llm' ||
          data.llm ||
          data.agent === 'llm-adaptive' ||
          data.agent === 'vendor-jd-llm'
        const totalTurns =
          typeof data.total === 'number' && data.total > 0
            ? data.total
            : adaptive
              ? INTERVIEW_TURN_COUNT
              : questions!.length
        return {
          sessionId: (data.sessionId as string) || `session-${Date.now().toString(36)}`,
          agent: llmAgent
            ? 'Ava · Google Gemini · adaptive'
            : (data.agent as string) || 'Ava · adaptive agent',
          llm: Boolean(llmAgent),
          total: totalTurns,
          questions: questions!,
          question: questions![0],
          offline: false,
          adaptive,
        }
      }
      if (isVendorJob) {
        throw new Error(
          String((data as { error?: string }).error || 'Interview start returned no questions.'),
        )
      }
    } else if (isVendorJob) {
      throw new Error(
        String((data as { error?: string }).error || `Interview start failed (${res.status})`),
      )
    }
  } catch (err) {
    if (isVendorJob) throw err
    console.warn('[interview] server start failed — continuing offline (no video/review sync):', err)
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
 * Score interview responses via HireRight API (server uses gemini-3.1-flash-lite).
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
Evaluate the candidate for role ${options.role} (${options.level}) using three internal rubrics (0–100 each):
- Correctness vs question + resume (penalize invented facts)
- Depth: tools, trade-offs, metrics, ownership
- Communication: clarity and STAR-style structure (not grammar/accent)

Per-answer weights vary: technical/skill questions weight correctness+depth ~80% total; project/behavioral questions weight communication higher.

Return ONLY valid JSON. Use candidate-facing category labels (NOT internal rubric names):
{
  "overall": 85,
  "categories": [
    {"label": "Role fit", "score": 88},
    {"label": "Impact & examples", "score": 82},
    {"label": "Clarity", "score": 86}
  ],
  "strengths": ["Specific, personalized bullets from THIS interview only"],
  "improvements": ["Specific, personalized growth bullets from THIS interview only"],
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

    const categories = Array.isArray(parsed.categories) && parsed.categories.length >= 3
      ? parsed.categories.slice(0, 3)
      : [
          { label: 'Role fit', score: overall },
          { label: 'Impact & examples', score: overall },
          { label: 'Clarity', score: overall },
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
