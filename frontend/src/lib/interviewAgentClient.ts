/**
 * HireRight Interview Agent Client
 * Synchronized with Google Gemini AI (gemini-2.5-flash).
 * Generates interactive, resume-tailored questions and rubric scoring.
 */
import type { Question, QuestionGenerationMeta, InterviewQuestionPlan } from './interviewEngine'
import { agentLabelForQuestionSource, deriveInterviewQuestionPlan } from './interviewEngine'
import type { AnswerAnalysis, IntegrityLogEvent, InterviewResult, SavedProfile } from './store'
import { apiFetch } from './api'
import { ensureApiSession } from './apiSession'
import { clientLlmAllowed } from './clientLlm'
import { candidateFullName } from './store'
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
  ? import.meta.env.VITE_EXPERIENTIALLABS_API_KEY ||
    import.meta.env.VITE_GEMINI_API_KEY ||
    import.meta.env.VITE_OPENAI_API_KEY ||
    ''
  : ''
function clientApiKey(): string {
  return (
    import.meta.env.VITE_EXPERIENTIALLABS_API_KEY ||
    import.meta.env.VITE_GEMINI_API_KEY ||
    import.meta.env.VITE_OPENAI_API_KEY ||
    ''
  ).trim()
}

function clientUsesGoogleGeminiKey(): boolean {
  const k = clientApiKey()
  return k.startsWith('AIza') || k.startsWith('AQ.')
}

const GEMINI_BASE_URL = (
  typeof window !== 'undefined' && clientLlmAllowed()
    ? '/ai-proxy'
    : clientUsesGoogleGeminiKey()
      ? import.meta.env.VITE_GEMINI_BASE_URL ||
        'https://generativelanguage.googleapis.com/v1beta/openai'
      : import.meta.env.VITE_EXPERIENTIALLABS_BASE_URL ||
        import.meta.env.VITE_GEMINI_BASE_URL ||
        import.meta.env.VITE_OPENAI_BASE_URL ||
        'https://generativelanguage.googleapis.com/v1beta/openai'
).replace(/\/$/, '')
const useGoogleGeminiHeaders =
  clientUsesGoogleGeminiKey() ||
  !import.meta.env.VITE_EXPERIENTIALLABS_BASE_URL?.includes('experientiallabs')

function llmRequestHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${GEMINI_API_KEY}`,
  }
  if (useGoogleGeminiHeaders) headers['x-goog-api-key'] = GEMINI_API_KEY
  return headers
}

const PRIMARY_MODEL = import.meta.env.VITE_PRIMARY_MODEL || 'gpt-6-luna'
const FALLBACK_MODEL = import.meta.env.VITE_FALLBACK_MODEL || 'gemini-2.5-flash'
const TERTIARY_MODEL = import.meta.env.VITE_LLM_TERTIARY_MODEL || 'gemini-3.8-flash'
const GEMINI_MODEL = PRIMARY_MODEL

function clientModelCascade(): string[] {
  const models = [PRIMARY_MODEL, FALLBACK_MODEL]
  if (clientUsesGoogleGeminiKey()) {
    const tertiary = TERTIARY_MODEL.trim()
    if (tertiary && !models.includes(tertiary)) models.push(tertiary)
  }
  return [...new Set(models)]
}

export type InterviewStartResponse = {
  sessionId: string | null
  agent: string
  llm: boolean
  total: number
  questions: Question[]
  question: Question
  offline?: boolean
  adaptive?: boolean
  questionMeta?: QuestionGenerationMeta
  questionPlan?: InterviewQuestionPlan
}

function metaFromApiPayload(data: Record<string, unknown>, question?: Question): QuestionGenerationMeta {
  const source: 'llm' | 'template' =
    data.questionSource === 'llm' ||
    question?.generationSource === 'llm' ||
    question?.focus === 'adaptive-llm' ||
    question?.focus === 'llm'
      ? 'llm'
      : 'template'
  return {
    questionSource: source,
    llmLatencyMs: (data.llmLatencyMs as number | null | undefined) ?? question?.llmLatencyMs ?? null,
    llmFailureReason:
      (data.llmFailureReason as string | null | undefined) ?? question?.llmFailureReason ?? null,
    llmModel: (data.llmModel as string | null | undefined) ?? question?.llmModel ?? null,
  }
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

  for (const m of clientModelCascade()) {
    try {
      const directRes = await fetch(`${GEMINI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: llmRequestHeaders(),
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
 * Generate resume-accurate questions directly using Gemini 2.5 Flash first,
 * falling back smoothly to Gemini 1.5 Flash.
 * Calibrated specifically for candidate's exact role and years of experience.
 */
async function generateGeminiQuestionsDirect(
  role: string,
  level: string,
  profile: SavedProfile | null,
  jobDescription?: string,
): Promise<Question[] | null> {
  if (!GEMINI_API_KEY) return null

  const candidateName = candidateFirstName(profile)
  const candidateFull =
    profile?.fullName?.trim() ||
    profile?.name?.trim() ||
    candidateFullName() ||
    'Candidate'
  const skills = Array.isArray(profile?.skills) ? profile.skills.join(', ') : 'Not specified'
  const experiences = (profile?.workExperiences || [])
    .map((w) => `${w.jobTitle || 'Role'} at ${w.company || 'Company'}: ${w.responsibilities || (w as any).description || ''}`)
    .join('\n')
  const resumeText = (profile?.resumeText || '').slice(0, 3500)

  const system = `You are Ava, HireRight's friendly AI Technical Interviewer powered by Google Gemini.
You conduct an interactive, spoken video interview.

ROLE & EXPERIENCE LEVEL CALIBRATION:
- Carefully analyze the candidate's exact target role ("${role}") and years of experience ("${level}"):
  * Freshers / Junior (0–2 Years): Ask approachable, encouraging questions about practical fundamentals, their college or internship projects, how they learn, and everyday tools. Keep questions accessible and confidence-building.
  * Mid-Level (2–5 Years): Ask practical questions about features they built, real-world bug troubleshooting, component/service design, and day-to-day tooling.
  * Senior / Lead (5+ Years): Ask about high-level architecture decisions, system trade-offs, scaling, and mentoring—while keeping questions conversational and straightforward.

SIMPLICITY & USER-FRIENDLINESS (MANDATORY):
- Keep all questions SIMPLE, USER-FRIENDLY, and EASY TO UNDERSTAND.
- Use natural, friendly spoken conversational English (like chatting with a supportive colleague).
- Avoid overly long, convoluted, academic, or confusing multi-part questions.
- Ask about ONE clear concept or story at a time so the candidate understands immediately and can answer comfortably.

Guidelines:
1. Explicitly cite real details from their resume (employers, projects, tools, skills).
2. Address the candidate by first name "${candidateName}" in the opening question.
3. If a target Job Description is provided, relate their resume experience to the job's core challenges.

Structure the 5 questions:
- Q1 (Communication): Warm intro welcoming ${candidateName}, referencing their focus area and strongest skills.
- Q2 (Technical Depth): A simple, practical question about a specific tool or language on their resume.
- Q3 (Resume Project): A friendly walkthrough of a project or feature they built.
- Q4 (Problem Solving): A straightforward challenge or bug they fixed.
- Q5 (Experience & Delivery): Team collaboration or delivering an impactful result.

Return ONLY valid JSON matching this schema:
{
  "questions": [
    {
      "text": "Simple spoken question text...",
      "category": "Communication" | "Technical" | "Problem Solving" | "Experience",
      "keywords": ["keyword1", "keyword2", "keyword3"],
      "hint": "Actionable guidance hint for candidate",
      "resumeAnchor": "Specific project or tool referenced from resume"
    }
  ]
}`

  const user = JSON.stringify({
    candidateFirstName: candidateName,
    candidateFullName: candidateFull,
    targetRole: role,
    targetLevel: level,
    jobDescription: jobDescription || 'Not specified',
    resumeSnippet: resumeText || 'Use candidate skills and profile',
    skillsList: skills,
    workHistory: experiences,
    whoAreYou: profile?.whoAreYou || '',
    keyStrengths: profile?.keyStrengths || '',
  })

  for (const m of clientModelCascade()) {
    try {
      const res = await fetch(`${GEMINI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: llmRequestHeaders(),
        body: JSON.stringify({
          model: m,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.3,
        }),
      })

      if (!res.ok) {
        console.warn(`[Client AI Cascade] Model "${m}" status ${res.status}. Falling back...`)
        continue
      }

      const data = await res.json()
      const content = data.choices?.[0]?.message?.content || ''
      const match = content.match(/\{[\s\S]*\}/)
      if (!match) continue

      const parsed = JSON.parse(match[0])
      if (!Array.isArray(parsed.questions) || parsed.questions.length < 3) continue

      const validCategories = ['Communication', 'Technical', 'Problem Solving', 'Experience'] as const

      return parsed.questions.slice(0, 5).map((q: any) => {
        const category = validCategories.includes(q.category) ? q.category : 'Technical'
        return {
          text: String(q.text || '').trim(),
          category,
          keywords: Array.isArray(q.keywords) ? q.keywords.map(String) : [category.toLowerCase()],
          hint: String(q.hint || 'Structure your answer with a concrete example and measurable outcome.').trim(),
          resumeAnchor: q.resumeAnchor ? String(q.resumeAnchor).trim() : undefined,
        }
      })
    } catch (err: any) {
      console.warn(`[Client AI Cascade] Model "${m}" error: ${err.message}. Falling back...`)
    }
  }

  return null
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
        adaptive: false,
        explicitRoleTrack: Boolean(explicitRoleTrack),
      }),
    })
    if (res.ok) {
      const data = await res.json()
      const adaptive = data.adaptive === true || data.mode === 'adaptive'
      const questions = data.questions as Question[]
      const hasQuestions = Array.isArray(questions) && questions.length >= 1
      if (hasQuestions) {
        const q0 = questions[0]
        const questionPlan =
          (data.questionPlan as InterviewQuestionPlan | undefined) ||
          deriveInterviewQuestionPlan(questions, adaptive)
        const questionMeta = metaFromApiPayload(data, q0)
        questionMeta.questionSource =
          questionPlan === 'llm-fixed' ? 'llm' : questionPlan === 'template-fixed' ? 'template' : questionMeta.questionSource
        const fromLlm = questionPlan === 'llm-fixed'
        return {
          sessionId: data.sessionId || `session-${Date.now().toString(36)}`,
          agent: fromLlm
            ? `Ava · AI interview (${questions.length} questions)`
            : `Ava · backup interview (${questions.length} questions)`,
          llm: fromLlm,
          total: questions.length,
          questions,
          question: q0,
          offline: false,
          adaptive,
          questionMeta,
          questionPlan,
        }
      }
    }
  } catch {
    // backend not running, proceed to direct Gemini call
  }

  // 2. Direct Google Gemini call — dev only
  if (clientLlmAllowed()) {
    try {
      const geminiQuestions = await generateGeminiQuestionsDirect(role, level, agentProfile, jobDescription)
      if (geminiQuestions && geminiQuestions.length >= 3) {
        const tagged = geminiQuestions.map((q) => ({
          ...q,
          generationSource: 'llm' as const,
          focus: q.focus || 'llm',
        }))
        return {
          sessionId: `gemini-${Date.now().toString(36)}`,
          agent: `Ava · AI interview (${tagged.length} questions)`,
          llm: true,
          total: tagged.length,
          questions: tagged,
          question: tagged[0],
          offline: false,
          adaptive: false,
          questionPlan: 'llm-fixed',
        }
      }
    } catch (err) {
      console.warn('[InterviewAgent] Direct Gemini generation fallback:', err)
    }
  }

  // 3. Offline: fixed template bank only (no LLM + no extra adaptive questions)
  const templateQuestions = buildResumeInterviewQuestions(role, level, agentProfile, jobDescription).map(
    (q) => ({
      ...q,
      generationSource: 'template' as const,
      focus: 'template-local',
    }),
  )
  return {
    sessionId: `local-${Date.now().toString(36)}`,
    agent: `Ava · backup interview (${templateQuestions.length} questions)`,
    llm: false,
    total: templateQuestions.length,
    questions: templateQuestions,
    question: templateQuestions[0],
    offline: true,
    adaptive: false,
    questionPlan: 'template-fixed',
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
      headers: llmRequestHeaders(),
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
