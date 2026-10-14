/**
 * HIRERIGHT Interview Agent
 * Generates resume-accurate questions and scores answers.
 * Uses OpenAI when OPENAI_API_KEY / LLM_API_KEY is set; otherwise a strong local agent.
 */

const CATEGORIES = ['Communication', 'Technical', 'Problem Solving', 'Experience']

/**
 * @typedef {{ text: string, category: string, keywords: string[], hint: string, focus?: string }} Question
 * @typedef {{
 *   name?: string,
 *   currentRole?: string,
 *   totalExperience?: string,
 *   skills?: string[],
 *   whoAreYou?: string,
 *   whatDrivesYou?: string,
 *   keyStrengths?: string,
 *   experienceSummary?: string,
 *   workExperiences?: { jobTitle?: string, company?: string, description?: string }[],
 *   achievements?: string[],
 *   certifications?: { name?: string }[],
 *   resumeText?: string,
 *   resumeName?: string | null,
 * }} ProfileContext
 */

function clean(s) {
  return String(s || '').trim()
}

function unique(arr) {
  return [...new Set(arr.filter(Boolean))]
}

const DEMO_ACCOUNT_NAME = 'Arjun Sharma'

/**
 * Prefer resume / profile name over generic demo account labels.
 * @param {ProfileContext} profile
 * @param {string} [accountName]
 */
export function resolveCandidateName(profile = {}, accountName = '') {
  const fromProfile = clean(profile.fullName) || clean(profile.name)
  if (fromProfile && fromProfile !== DEMO_ACCOUNT_NAME) return fromProfile

  const resume = clean(profile.resumeText)
  if (resume) {
    const lines = resume
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    for (const line of lines.slice(0, 10)) {
      if (
        line.length >= 4 &&
        line.length <= 64 &&
        /^[A-Z][A-Za-z.'-]+(\s+[A-Z][A-Za-z.'-]+){0,4}$/.test(line)
      ) {
        return line
      }
    }
  }

  if (profile.resumeName) {
    const words = profile.resumeName
      .replace(/\.[^/.]+$/, '')
      .replace(/[_-]/g, ' ')
      .replace(
        /\b(resume|cv|biodata|profile|fullstack|frontend|backend|engineer|developer)\b/gi,
        '',
      )
      .trim()
      .split(/\s+/)
      .filter((w) => w.length >= 2 && /^[A-Za-z]+$/.test(w))
    if (words.length >= 2 && words.length <= 4) {
      return words
        .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
        .join(' ')
    }
  }

  if (fromProfile) return fromProfile
  const acct = clean(accountName)
  if (acct && acct !== DEMO_ACCOUNT_NAME) return acct
  return fromProfile || acct || 'Candidate'
}

/** @param {string} full */
export function firstNameFromFull(full) {
  const n = clean(full)
  if (!n || n === 'Candidate') return 'there'
  return n.split(/\s+/)[0]
}

/** @param {ProfileContext} profile */
export function summarizeProfile(profile = {}, accountName = '') {
  const resolvedName = resolveCandidateName(profile, accountName)
  const skills = unique((profile.skills || []).map((s) => clean(s))).slice(0, 16)
  const jobs = (profile.workExperiences || [])
    .filter((w) => w?.jobTitle || w?.company)
    .slice(0, 4)
    .map((w) => `${clean(w.jobTitle) || 'Role'} @ ${clean(w.company) || 'Company'}${w.description ? `: ${clean(w.description).slice(0, 180)}` : ''}`)
  const achievements = (profile.achievements || []).map(clean).filter(Boolean).slice(0, 5)
  const certs = (profile.certifications || []).map((c) => clean(c?.name)).filter(Boolean).slice(0, 5)
  const resumeSnippet = clean(profile.resumeText).slice(0, 3500)

  return {
    name: resolvedName,
    role: clean(profile.currentRole) || 'Software professional',
    experience: clean(profile.totalExperience) || 'Not specified',
    skills,
    whoAreYou: clean(profile.whoAreYou).slice(0, 600),
    whatDrivesYou: clean(profile.whatDrivesYou).slice(0, 400),
    keyStrengths: clean(profile.keyStrengths).slice(0, 400),
    experienceSummary: clean(profile.experienceSummary).slice(0, 800),
    jobs,
    achievements,
    certs,
    resumeSnippet,
    resumeName: profile.resumeName || null,
  }
}

/** Local resume-aware question bank (no API key required). */
/** @param {ReturnType<typeof summarizeProfile>} ctx */
/** @param {string} role */
/** @param {string} level */
export function generateLocalQuestions(ctx, role, level) {
  /** @type {Question[]} */
  const questions = []
  const skillA = ctx.skills[0]
  const skillB = ctx.skills[1] || ctx.skills[0]
  const skillC = ctx.skills[2]
  const job = ctx.jobs[0]
  const achievement = ctx.achievements[0]

  questions.push({
    text:
      ctx.resumeSnippet || ctx.skills.length
        ? `${ctx.name}, I've reviewed your resume for ${ctx.role || role}. Walk me through your background in 90 seconds — what should a hiring manager remember?`
        : ctx.whoAreYou
          ? `${ctx.name}, your profile says you are focused on “${ctx.role}”. Walk me through your background in 90 seconds — what should a hiring manager remember about you?`
          : `Tell me about yourself as a ${role} with ${level} experience. What should we remember about you?`,
    category: 'Communication',
    keywords: unique([
      'experience',
      'project',
      'skill',
      'built',
      'team',
      ...ctx.skills.slice(0, 4).map((s) => s.toLowerCase()),
      ctx.role.toLowerCase(),
    ]),
    hint: 'Background → strongest skills → one concrete win.',
    focus: 'intro',
  })

  if (skillA) {
    questions.push({
      text: `Your resume/profile lists ${skillA}${skillB && skillB !== skillA ? ` and ${skillB}` : ''}. Describe a real project where you used ${skillA}: what you built, your role, and the measurable outcome.`,
      category: 'Technical',
      keywords: unique([
        skillA.toLowerCase(),
        ...(skillB ? [skillB.toLowerCase()] : []),
        'project',
        'built',
        'result',
        'impact',
        'challenge',
      ]),
      hint: 'Name the skill, the project, actions, and a metric.',
      focus: 'skill-depth',
    })
  } else {
    questions.push({
      text: `As a ${role}, what technical skill are you strongest in, and how have you applied it in production?`,
      category: 'Technical',
      keywords: ['skill', 'production', 'built', 'project', 'result', role.toLowerCase()],
      hint: 'Pick one skill and give a production example.',
      focus: 'skill-depth',
    })
  }

  if (job) {
    questions.push({
      text: `On your profile I see ${job.split(':')[0]}. What was the hardest problem you owned there, and how did you solve it?`,
      category: 'Problem Solving',
      keywords: unique([
        'problem',
        'solution',
        'approach',
        'result',
        'owned',
        'impact',
        ...job.toLowerCase().split(/\W+/).filter((w) => w.length > 3).slice(0, 6),
      ]),
      hint: 'STAR: situation → task → action → result.',
      focus: 'experience',
    })
  } else if (ctx.experienceSummary) {
    questions.push({
      text: `Based on your experience summary, describe a challenge you faced and how you solved it end-to-end.`,
      category: 'Problem Solving',
      keywords: ['problem', 'solution', 'approach', 'result', 'challenge', 'because'],
      hint: 'Be specific about actions and outcomes.',
      focus: 'experience',
    })
  } else {
    questions.push({
      text: 'Describe a challenging technical or product problem you faced and how you solved it.',
      category: 'Problem Solving',
      keywords: ['problem', 'solution', 'approach', 'result', 'debug', 'impact'],
      hint: 'Use STAR and include a measurable result.',
      focus: 'experience',
    })
  }

  if (achievement) {
    questions.push({
      text: `You mentioned this achievement: “${achievement.slice(0, 160)}”. How did you personally drive that result, and what would you do differently next time?`,
      category: 'Experience',
      keywords: unique([
        'result',
        'impact',
        'led',
        'improved',
        'metric',
        ...achievement.toLowerCase().split(/\W+/).filter((w) => w.length > 3).slice(0, 5),
      ]),
      hint: 'Your contribution vs the team, plus a lesson learned.',
      focus: 'achievement',
    })
  } else if (skillC) {
    questions.push({
      text: `How would you compare your depth in ${skillA || role} versus ${skillC}? Give an example that proves the difference.`,
      category: 'Experience',
      keywords: unique([
        (skillA || role).toLowerCase(),
        skillC.toLowerCase(),
        'example',
        'depth',
        'project',
      ]),
      hint: 'Contrast two skills with concrete proof.',
      focus: 'achievement',
    })
  } else {
    questions.push({
      text: 'Tell me about a time you delivered under a tight deadline. What did you prioritize and what shipped?',
      category: 'Experience',
      keywords: ['deadline', 'priority', 'deliver', 'team', 'shipped', 'plan'],
      hint: 'Priorities, trade-offs, and the outcome.',
      focus: 'achievement',
    })
  }

  questions.push({
    text: skillA
      ? `For a ${role} role at your level (${level}), how would you ramp up in the first 90 days using strengths like ${skillA}? What would you learn next?`
      : `Where do you want to grow as a ${role} over the next two years, and how does that connect to this interview track?`,
    category: 'Communication',
    keywords: unique([
      'grow',
      'learn',
      'goal',
      'plan',
      'contribute',
      ...(skillA ? [skillA.toLowerCase()] : []),
    ]),
    hint: 'Tie growth to real skills and business impact.',
    focus: 'growth',
  })

  return questions.slice(0, 5).map((q) => ({
    ...q,
    generationSource: 'template',
    focus: q.focus || 'template-local',
  }))
}

/**
 * Optional OpenAI / OpenAI-compatible LLM generation.
 * @param {ReturnType<typeof summarizeProfile>} ctx
 * @param {string} role
 * @param {string} level
 * @returns {Promise<Question[] | null>}
 */
/**
 * Dedicated LLM API caller supporting Google Gemini 2.5 Flash as primary,
 * with automatic fallback to Gemini 1.5 Flash and other models.
 */
function llmGatewayBase() {
  return (process.env.OPENAI_BASE_URL || '').replace(/\/$/, '')
}

function isExperientialLabsGateway(base = llmGatewayBase()) {
  return /experientiallabs/i.test(base)
}

const GOOGLE_OPENAI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai'
const EXPERIENTIAL_BASE = 'https://api.experientiallabs.ai/v1'

/** Google Cloud / Gemini keys (not Experiential xpl_ keys). */
function isGoogleStyleApiKey(apiKey) {
  return apiKey.startsWith('AIza') || apiKey.startsWith('AQ.')
}

/** Interview LLM order: cheap primary → Gemini backup (override via PRIMARY_MODEL / FALLBACK_MODEL). */
const DEFAULT_PRIMARY_MODEL = 'gpt-6-luna'
const DEFAULT_FALLBACK_MODEL = 'gemini-2.5-flash'

/**
 * AQ./AIza keys authenticate with Google, not ExperientialLabs (xpl_).
 * @param {string} apiKey
 */
export function resolveLlmTransport(apiKey) {
  const configured = llmGatewayBase()
  const forceExperiential = process.env.FORCE_EXPERIENTIALLABS === 'true'

  if (!forceExperiential && isGoogleStyleApiKey(apiKey)) {
    if (configured && isExperientialLabsGateway(configured)) {
      console.info(
        '[LLM] Google-style API key detected — routing to Google Gemini OpenAI endpoint (not ExperientialLabs). Use an xpl_ key for ExperientialLabs.',
      )
    }
    return { base: GOOGLE_OPENAI_BASE, isGemini: true, provider: 'google-gemini' }
  }

  if (apiKey.startsWith('xpl_')) {
    const base = configured || EXPERIENTIAL_BASE
    return { base, isGemini: false, provider: 'experiential' }
  }

  const base =
    configured ||
    (apiKey.startsWith('AIza') ? GOOGLE_OPENAI_BASE : 'https://api.openai.com/v1')

  const isGemini =
    !isExperientialLabsGateway(base) &&
    (Boolean(process.env.GEMINI_API_KEY) ||
      isGoogleStyleApiKey(apiKey) ||
      base.includes('generativelanguage.googleapis.com'))

  return { base, isGemini, provider: isGemini ? 'google-gemini' : 'openai-compatible' }
}

function buildModelCascade(transport) {
  const primaryModel =
    process.env.PRIMARY_MODEL ||
    process.env.OPENAI_MODEL ||
    process.env.GEMINI_MODEL ||
    DEFAULT_PRIMARY_MODEL
  const fallbackModel = process.env.FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL

  /** @type {string[]} */
  const names = [primaryModel, fallbackModel]

  // Google-native keys cannot call Experiential slugs; try tertiary only after 404 on both.
  if (transport.provider === 'google-gemini') {
    const tertiary = (process.env.LLM_TERTIARY_MODEL || 'gemini-3.8-flash').trim()
    if (tertiary && !names.includes(tertiary)) names.push(tertiary)
  }

  const uniqueNames = [...new Set(names.filter(Boolean))]
  return uniqueNames.map((name) => ({
    name,
    label:
      name === DEFAULT_PRIMARY_MODEL
        ? `Primary · ${name}`
        : name === DEFAULT_FALLBACK_MODEL
          ? `Fallback · ${name}`
          : transport.provider === 'experiential'
            ? `ExperientialLabs · ${name}`
            : name,
  }))
}

/** Models used for interview question generation (primary first). */
export function interviewModelCascade() {
  const apiKey =
    process.env.EXPERIENTIALLABS_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    ''
  if (!apiKey) {
    return { primary: DEFAULT_PRIMARY_MODEL, fallback: DEFAULT_FALLBACK_MODEL, transport: 'none' }
  }
  const transport = resolveLlmTransport(apiKey)
  const cascade = buildModelCascade(transport)
  return {
    primary: cascade[0]?.name || DEFAULT_PRIMARY_MODEL,
    fallback: cascade[1]?.name || DEFAULT_FALLBACK_MODEL,
    tertiary: cascade[2]?.name || null,
    transport: transport.provider,
  }
}

/** Last LLM HTTP attempt (for API telemetry + template fallback reasons). */
let lastLlmAttempt = {
  latencyMs: 0,
  reason: /** @type {string | null} */ (null),
  statusCode: /** @type {number | null} */ (null),
  timedOut: false,
  model: /** @type {string | null} */ (null),
}

export function getLastLlmAttempt() {
  return { ...lastLlmAttempt }
}

function resetLastLlmAttempt() {
  lastLlmAttempt = {
    latencyMs: 0,
    reason: null,
    statusCode: null,
    timedOut: false,
    model: null,
  }
}

/** @param {string} raw */
function parseLlmJsonObject(raw) {
  const text = clean(raw)
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidates = [fenced?.[1], text].filter(Boolean)
  for (const chunk of candidates) {
    const slice = String(chunk).trim()
    try {
      return JSON.parse(slice)
    } catch {
      const match = slice.match(/\{[\s\S]*\}/)
      if (match) {
        try {
          return JSON.parse(match[0])
        } catch {
          // try next
        }
      }
    }
  }
  return null
}

export async function callLlmApi({ system, user, temperature = 0.3 }) {
  const apiKey =
    process.env.EXPERIENTIALLABS_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.LLM_API_KEY
  if (!apiKey) {
    resetLastLlmAttempt()
    lastLlmAttempt.reason = 'no_api_key'
    return null
  }

  resetLastLlmAttempt()
  const started = Date.now()
  const timeoutMs = Number(process.env.LLM_REQUEST_TIMEOUT_MS) || 45_000

  const transport = resolveLlmTransport(apiKey)
  const base = transport.base.replace(/\/$/, '')

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
  if (transport.isGemini) {
    headers['x-goog-api-key'] = apiKey
  } else {
    headers['HTTP-Referer'] = 'http://localhost:5173'
    headers['X-Title'] = 'HIRERIGHTTT'
  }

  const candidateModels = buildModelCascade(transport)

  for (let i = 0; i < candidateModels.length; i++) {
    const { name: currentModel, label } = candidateModels[i]
    lastLlmAttempt.model = currentModel
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: currentModel,
          temperature,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      })

      if (res.ok) {
        const data = await res.json()
        const text = data.choices?.[0]?.message?.content || ''
        if (text.trim()) {
          const usage = data.usage || {}
          const tokenUsage = {
            promptTokens: usage.prompt_tokens || 0,
            completionTokens: usage.completion_tokens || 0,
            totalTokens: usage.total_tokens || 0,
          }
          lastLlmAttempt.latencyMs = Date.now() - started
          lastLlmAttempt.reason = null
          lastLlmAttempt.statusCode = res.status
          console.log(
            `🔥 [${label}] Success in ${lastLlmAttempt.latencyMs}ms! Prompt tokens: ${tokenUsage.promptTokens} | Completion: ${tokenUsage.completionTokens} | Total: ${tokenUsage.totalTokens}`,
          )
          return { text, tokenUsage, provider: label, model: currentModel, latencyMs: lastLlmAttempt.latencyMs }
        }
        lastLlmAttempt.reason = 'empty_response'
        lastLlmAttempt.statusCode = res.status
      } else {
        const errText = await res.text().catch(() => '')
        lastLlmAttempt.statusCode = res.status
        lastLlmAttempt.reason =
          res.status === 401 || res.status === 403
            ? 'auth_error'
            : res.status === 429
              ? 'rate_limited'
              : 'http_error'
        console.warn(
          `[LLM Fallback Trigger] Model "${currentModel}" status ${res.status} (${Date.now() - started}ms). Falling back...`,
          errText.slice(0, 160),
        )
      }
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'AbortError'
      lastLlmAttempt.timedOut = isTimeout
      lastLlmAttempt.reason = isTimeout ? 'timeout' : 'network_error'
      console.warn(
        `[LLM Fallback Trigger] Model "${currentModel}" ${isTimeout ? 'timed out' : 'error'} (${Date.now() - started}ms): ${err instanceof Error ? err.message : err}. Falling back...`,
      )
    } finally {
      clearTimeout(timer)
    }
  }

  lastLlmAttempt.latencyMs = Date.now() - started
  if (!lastLlmAttempt.reason) lastLlmAttempt.reason = 'all_models_failed'
  console.warn(
    `[LLM] No model returned text after ${lastLlmAttempt.latencyMs}ms (${lastLlmAttempt.reason}). Using server template question.`,
  )
  return null
}

/**
 * Generate LLM interview questions based on Job Description (JD), Role, & Candidate Profile.
 * Uses Gemini 2.5 Flash first with fallback to Luna.
 * Tailors difficulty based on candidate's exact role and years of experience.
 * Formulates simple, conversational, and user-friendly spoken questions.
 * @param {ReturnType<typeof summarizeProfile>} ctx
 * @param {string} role
 * @param {string} level
 * @param {string} [jobDescription]
 */
export async function generateLlmQuestions(ctx, role, level, jobDescription = '') {
  const jdText = clean(jobDescription)
  const first = firstNameFromFull(ctx.name)
  const system = `You are Ava, HIRERIGHT's friendly AI interviewer. Generate exactly 5 interactive, spoken interview questions.

ROLE & EXPERIENCE CALIBRATION:
- Carefully analyze the candidate's exact target role ("${role}") and years of experience ("${level}"):
  * Freshers / Junior (0–2 Years): Ask approachable, encouraging questions about practical fundamentals, their college or internship projects, how they learn, and everyday tools. Keep questions accessible and confidence-building.
  * Mid-Level (2–5 Years): Ask practical questions about features they built, real-world bug troubleshooting, component/service design, and day-to-day tooling.
  * Senior / Lead (5+ Years): Ask about high-level architecture decisions, system trade-offs, scaling, and mentoring—while keeping questions conversational and straightforward.

SIMPLICITY & USER-FRIENDLINESS (MANDATORY):
- Keep all questions SIMPLE, USER-FRIENDLY, and EASY TO UNDERSTAND.
- Use natural, friendly spoken conversational English (like chatting with a supportive colleague).
- Avoid overly long, convoluted, academic, or confusing multi-part questions.
- Ask about ONE clear concept or story at a time so the candidate understands immediately and can answer comfortably.

PRIMARY SOURCE: Cite real details from their resume (employers, projects, tools, skills).
Address the candidate by first name "${first}" in at least the first question.

Structure the 5 questions:
1. Communication & Welcome: Warm, friendly greeting to "${first}", asking them to introduce themselves and touch on what they enjoy most about their work with [mention their top skill/project].
2. Practical Technical Question: A straightforward, role-appropriate question about a specific tool or language on their CV.
3. Project Walkthrough: A friendly question asking them to share the story of a specific project they worked on and what they built.
4. Problem Solving: A simple question about a bug, challenge, or obstacle they ran into and how they resolved it.
5. Experience & Collaboration: A clear question about working with others or delivering a feature they are proud of.

Return ONLY valid JSON matching this schema:
{"questions":[{"text":"Simple spoken question text...","category":"Communication|Technical|Problem Solving|Experience","keywords":["..."],"hint":"Helpful guidance hint...","resumeAnchor":"..."}]}`

  const user = JSON.stringify({
    roleTrack: role,
    experienceLevel: level,
    jobDescription: jdText || 'Not specified (use role and candidate skills)',
    candidateProfile: ctx,
  })

  const llmResult = await callLlmApi({ system, user })
  if (!llmResult || !llmResult.text) return null

  try {
    const match = llmResult.text.match(/\{[\s\S]*\}/)
    if (!match) return null
    const parsed = JSON.parse(match[0])
    const list = Array.isArray(parsed.questions) ? parsed.questions : []
    const normalized = list
      .map((q) => ({
        text: clean(q.text),
        category: CATEGORIES.includes(q.category) ? q.category : 'Technical',
        keywords: unique((q.keywords || []).map((k) => clean(k).toLowerCase())).slice(0, 12),
        hint: clean(q.hint) || 'Be specific and give a concrete example.',
        focus: 'llm',
        generationSource: 'llm',
      }))
      .filter((q) => q.text.length > 20)
    return normalized.length >= 3 ? normalized.slice(0, 5) : null
  } catch (err) {
    console.warn('[interview-agent] Error parsing LLM question JSON:', err)
    return null
  }
}

/**
 * @param {ProfileContext} profile
 * @param {string} role
 * @param {string} level
 * @param {string} [jobDescription]
 */
/**
 * Interactive spoken bridge after each answer (acknowledgment + optional nudge).
 * @param {object} input
 */
export async function generateInterviewTurn(input) {
  const ctx = input.ctx || summarizeProfile(input.profile || {})
  const first = firstNameFromFull(ctx.name)
  const answer = clean(input.answer)
  const wordCount = answer.split(/\s+/).filter(Boolean).length
  const question = input.question || {}
  const nextQuestion = input.nextQuestion || {}

  const system = `You are Ava, a live voice interviewer on a phone-style call. The candidate "${first}" just answered.
Reply in 1-2 short spoken sentences: warm acknowledgment only — do NOT ask a new question (the next question comes separately). Sound human and concise, like ElevenLabs conversational agents.
Return ONLY JSON: {"spoken":"..."}`

  const user = JSON.stringify({
    candidateFirstName: first,
    targetRole: input.role,
    level: input.level,
    questionAnswered: question.text,
    category: question.category,
    answer: answer || '(no answer)',
    wordCount,
    resumeSkills: ctx.skills?.slice(0, 10),
    nextTopicHint: nextQuestion.category || 'next area',
    progress: `${(input.questionIndex ?? 0) + 1}/${input.totalQuestions ?? '?'}`,
  })

  const llm = await callLlmApi({ system, user })
  if (llm?.text) {
    try {
      const match = llm.text.match(/\{[\s\S]*\}/)
      if (match) {
        const parsed = JSON.parse(match[0])
        const spoken = clean(parsed.spoken)
        if (spoken.length > 8) {
          return { spoken, interactive: true, agent: llm.provider || 'llm' }
        }
      }
    } catch {
      // fallback below
    }
  }

  let spoken
  if (wordCount < 8) {
    spoken = `Thanks ${first}. When you're ready, add a concrete example from your resume — we'll keep going. `
  } else if (wordCount < 22) {
    spoken = `Thanks ${first}, I hear you. Let's go a bit deeper on the next one. `
  } else {
    spoken = `Great, ${first} — that connects well with your background. `
  }
  if (input.questionIndex != null && input.totalQuestions != null) {
    spoken +=
      input.questionIndex + 1 >= input.totalQuestions - 1
        ? 'One more question for us.'
        : "Let's move to the next topic."
  }
  return { spoken, interactive: false, agent: 'hireright-agent' }
}

const TECH_CLAIM_RE =
  /\b(java|python|javascript|typescript|react|node\.?js|angular|vue|spring|kotlin|go|golang|rust|c\+\+|c#|\.net|sql|postgresql|mongodb|mysql|redis|kafka|aws|azure|gcp|docker|kubernetes|graphql|microservices|flutter|swift|android)\b/gi

const STACK_CLAIM_RE =
  /\b(full[\s-]?stack(?:\s+development|\s+engineering)?|front[\s-]?end(?:\s+development)?|back[\s-]?end(?:\s+development)?|mern|mean|devops|ui\/ux|mobile\s+development)\b/gi

const SUBJECT_CLAIM_RE =
  /\b(math|mathematics|statistics|calculus|algebra|geometry|physics|chemistry|biology|nursing|finance|accounting|marketing|sales|leadership|communication|writing|design|cad|mechanical|electrical|civil|structural|pipelines?|safety|hse|healthcare)\b/gi

/** @param {string} s */
function titleCasePhrase(s) {
  const t = clean(s)
  if (!t) return t
  return t
    .split(/\s+/)
    .map((w) => {
      if (w.length <= 3 && !/^[a-z]{2,3}$/i.test(w)) return w.toUpperCase()
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    })
    .join(' ')
}

/** @param {string} text */
export function extractClaimedSkills(text) {
  const found = []
  const lower = clean(text).toLowerCase()
  let m
  const stackRe = new RegExp(STACK_CLAIM_RE.source, 'gi')
  while ((m = stackRe.exec(lower))) {
    found.push(m[1])
  }
  const goodAt = lower.match(
    /(?:good at|great at|strong in|strong at|experienced in|expert in|skilled in|proficient in|specializ(?:e|ing) in)\s+([a-z0-9+#./\s-]{2,56})/i,
  )
  if (goodAt) {
    goodAt[1]
      .split(/,|\band\b/)
      .map((s) => s.trim().replace(/\.$/, ''))
      .filter(Boolean)
      .forEach((s) => found.push(s))
  }
  const techRe = new RegExp(TECH_CLAIM_RE.source, 'gi')
  while ((m = techRe.exec(lower))) {
    found.push(m[1])
  }
  const subjRe = new RegExp(SUBJECT_CLAIM_RE.source, 'gi')
  while ((m = subjRe.exec(lower))) {
    found.push(m[1])
  }
  return unique(found.map(titleCasePhrase)).slice(0, 5)
}

/** @param {ReturnType<typeof summarizeProfile>} ctx @param {object[]} history */
function pickResumeTopicFromCtx(ctx, history) {
  const asked = new Set(
    (history || []).map((h) => clean(h.question?.topic || h.question?.text?.slice(0, 40)).toLowerCase()),
  )
  for (const jobLine of ctx.jobs || []) {
    const topic = clean(jobLine).slice(0, 80)
    if (topic && !asked.has(topic.toLowerCase())) {
      return { topic, label: topic }
    }
  }
  for (const skill of ctx.skills || []) {
    const key = clean(skill).toLowerCase()
    if (key && !asked.has(key)) return { topic: skill, label: skill }
  }
  for (const ach of ctx.achievements || []) {
    const key = clean(ach).slice(0, 48).toLowerCase()
    if (key && !asked.has(key)) return { topic: 'Resume highlight', label: clean(ach).slice(0, 120) }
  }
  return null
}

/** @param {string} first @param {string} skill @param {string} role @param {boolean} roleTrack */
function buildClaimedSkillQuestion(first, skill, role, roleTrack) {
  const fullStackLike = /full[\s-]?stack|mern|mean/i.test(skill)
  const mathLike = /math|statistic|calculus|algebra|geometry/i.test(skill)
  if (fullStackLike) {
    return `${first}, you said you're good at ${skill}. Pick one real product feature and walk me through it end to end — client/UI, APIs or services, database, auth if any, and how you tested and shipped it.`
  }
  if (mathLike) {
    return `${first}, you said you're strong in ${skill}. Walk me through a problem you solved with ${skill} — setup, method, and how you verified the result.`
  }
  const roleBit = roleTrack && role ? ` in a ${role} context` : ''
  return `${first}, you mentioned ${skill}. Describe a concrete situation where you applied ${skill}${roleBit} — challenge, actions, and outcome.`
}

/**
 * One adaptive question — follows candidate claims (e.g. "good at Java") and never repeats prior questions.
 * @param {object} input
 */
export async function generateAdaptiveQuestion(input) {
  const ctx = input.ctx || summarizeProfile(input.profile || {}, input.accountName || '')
  const role = input.role || 'Full Stack Engineer'
  const level = input.level || '1–3 years'
  const jobDescription = clean(input.jobDescription)
  const explicitRoleTrack =
    input.explicitRoleTrack === true || jobDescription.length >= 40
  const questionAnchorMode = explicitRoleTrack ? 'role_track' : 'resume_first'
  const history = Array.isArray(input.history) ? input.history : []
  const lastAnswer = clean(input.lastAnswer)
  const first = firstNameFromFull(ctx.name)
  const priorTexts = history.map((h) => clean(h.question?.text || h.question)).filter(Boolean)
  const claimed = extractClaimedSkills(lastAnswer)
  const focusSkill = claimed[0] || null

  const system = `You are Ava, a live ADAPTIVE interviewer. Generate exactly ONE new spoken question (JSON only).

ROLE & EXPERIENCE CALIBRATION:
- Analyze the candidate's exact roleTrack ("${role}") and experienceLevel ("${level}"):
  * Freshers / Junior (0–2 Years): Ask encouraging, simple questions about fundamentals, college/internship projects, or how they solved an everyday coding issue.
  * Mid-Level (2–5 Years): Ask practical, concrete questions about feature implementation, debugging, or tools they used.
  * Senior / Lead (5+ Years): Ask about high-level design decisions, trade-offs, and scaling, while keeping question phrasing clear, straightforward, and conversational.

SIMPLICITY & USER-FRIENDLINESS:
- Keep the question SIMPLE, CONVERSATIONAL, and EASY TO UNDERSTAND.
- Avoid multi-part, convoluted, or overly academic phrasing.
- Ask about ONE clear concept or experience at a time so the candidate can answer confidently.

RULES:
- Do NOT repeat or paraphrase any prior question listed in priorQuestions.
- If the candidate's last answer mentions a skill or says they are "good at" something, drill into that topic in a friendly, conversational way.
- Anchor questions on resumeSnippet, resumeJobs, resumeSkills, or achievements when possible.
- Include a short topic label (e.g. "React Components", "Database Queries", "API Design").
Return: {"question":{"text":"Simple, clear spoken question text...","category":"Communication|Technical|Problem Solving|Experience","keywords":["..."],"hint":"Helpful guidance hint...","topic":"...","resumeAnchor":"optional"}}`

  const user = JSON.stringify({
    candidateFirstName: first,
    roleTrack: role,
    experienceLevel: level,
    questionAnchorMode,
    jobDescription: jobDescription || null,
    resumeSkills: ctx.skills?.slice(0, 16),
    resumeJobs: ctx.jobs?.slice(0, 6),
    resumeAchievements: ctx.achievements?.slice(0, 5),
    resumeSnippet: ctx.resumeSnippet?.slice(0, 2500),
    priorQuestions: priorTexts,
    lastAnswer,
    claimedSkills: claimed,
    turnNumber: history.length + 1,
    instruction: focusSkill
      ? `Candidate claimed strength in "${focusSkill}". Next question MUST test "${focusSkill}" directly (for Full Stack: end-to-end feature design).`
      : questionAnchorMode === 'role_track'
        ? `Ask a challenging ${role} (${level}) question aligned with the role track; reference resume when possible.`
        : 'Pick a new topic from the resume not yet covered in priorQuestions.',
  })

  const llm = await callLlmApi({ system, user, temperature: 0.72 })
  const llmMeta = getLastLlmAttempt()
  if (llm?.text) {
    try {
      const parsed = parseLlmJsonObject(llm.text)
      if (parsed) {
        const q = parsed.question || parsed
        const text = clean(q.text)
        if (text.length > 20) {
          return {
            text,
            category: CATEGORIES.includes(q.category) ? q.category : 'Technical',
            keywords: unique((q.keywords || []).map((k) => clean(k).toLowerCase())).slice(0, 12),
            hint: clean(q.hint) || 'Give a concrete example with tools and outcome.',
            topic: clean(q.topic) || clean(q.category) || 'Technical',
            resumeAnchor: clean(q.resumeAnchor) || undefined,
            focus: 'adaptive-llm',
            generationSource: 'llm',
            llmLatencyMs: llm.latencyMs ?? llmMeta.latencyMs,
            llmModel: llm.model ?? llmMeta.model ?? undefined,
          }
        }
      }
      console.warn('[LLM] Response received but JSON question parse failed — using server template.')
      lastLlmAttempt.reason = 'parse_error'
    } catch {
      lastLlmAttempt.reason = 'parse_error'
    }
  }

  /** @type {import('./interviewAgent.mjs').Question} */
  let text
  let topic
  let category = 'Technical'

  if (history.length === 0) {
    topic = 'Introduction'
    category = 'Communication'
    if (questionAnchorMode === 'role_track') {
      text = ctx.resumeSnippet
        ? `${first}, I'm interviewing you for the ${role} track (${level}). I've read your resume — in 90 seconds, connect your background to this role and what you're strongest in.`
        : `${first}, welcome to the ${role} interview (${level}). Introduce yourself and the skills that fit this role best.`
    } else {
      text = ctx.resumeSnippet
        ? `${first}, I've reviewed your resume in detail. In 90 seconds, walk me through your background — roles, projects, and tools that stand out on your CV.`
        : `${first}, welcome. Introduce yourself from your experience and share what you're best at.`
    }
  } else if (focusSkill) {
    topic = focusSkill
    text = buildClaimedSkillQuestion(first, focusSkill, role, explicitRoleTrack)
  } else if (questionAnchorMode === 'role_track' && role === 'Full Stack Engineer') {
    topic = role
    category = 'Technical'
    text = `${first}, for ${role} (${level}): describe a feature you owned from UI through API and database — trade-offs, testing, and how you deployed it.`
  } else {
    const resumeTopic = pickResumeTopicFromCtx(ctx, history)
    if (resumeTopic) {
      topic = resumeTopic.topic
      category = 'Experience'
      text = `${first}, on your resume I see ${resumeTopic.label}. Walk me through that work — your responsibility, a hard decision, and the outcome.`
    } else if (ctx.skills?.length) {
      const askedTopics = history.map((h) => h.question?.topic).filter(Boolean)
      const skill =
        ctx.skills.find((s) => !askedTopics.some((t) => t.toLowerCase() === s.toLowerCase())) ||
        ctx.skills[history.length % ctx.skills.length]
      topic = skill
      text = `${first}, let's go deeper on ${skill} from your background. Describe a production challenge you solved with it and how you validated the fix.`
    } else {
      topic = 'Problem Solving'
      category = 'Problem Solving'
      text = `${first}, describe a tough problem you owned end-to-end — what broke, how you debugged it, and what shipped.`
    }
  }

  return {
    text,
    category,
    keywords: unique([topic.toLowerCase(), 'project', 'built', 'result', role.toLowerCase()]),
    hint: 'Be specific: stack, your role, and a metric or outcome.',
    topic,
    focus: 'adaptive-local',
    generationSource: 'template',
    llmLatencyMs: llmMeta.latencyMs,
    llmFailureReason: llmMeta.reason || (llm ? 'parse_error' : 'llm_unavailable'),
  }
}

/** @param {import('./interviewAgent.mjs').Question} question */
export function questionGenerationPayload(question) {
  const source =
    question?.generationSource ||
    (question?.focus === 'adaptive-llm' ? 'llm' : 'template')
  return {
    questionSource: source,
    llmLatencyMs: question?.llmLatencyMs ?? null,
    llmFailureReason: source === 'template' ? question?.llmFailureReason ?? null : null,
    llmModel: source === 'llm' ? question?.llmModel ?? null : null,
  }
}

function analyzeAnswerDetailed(question, answer, ctx) {
  const base = analyzeAnswer(question, answer, ctx)
  const accuracy = Math.min(10, Math.max(2, Math.round(base.score / 10)))
  const clarity = Math.min(10, Math.max(2, Math.round(base.wordCount / 12 + base.keywordsHit.length)))
  const understanding = Math.min(10, Math.max(2, Math.round((base.keywordsHit.length * 1.5) + (base.score >= 70 ? 3 : 1))))
  const depth = Math.min(10, Math.max(2, Math.round(base.score / 12)))
  const total40 = Math.min(40, accuracy + clarity + understanding + depth)
  const stars = '★'.repeat(Math.max(1, Math.round((total40 / 40) * 5))).padEnd(5, '☆')
  return {
    ...base,
    topic: question.topic || question.category || 'Interview',
    accuracy,
    clarity,
    understanding,
    depth,
    total40,
    stars,
  }
}

/** @param {object} params */
export function buildCareerScorecard(params) {
  const {
    ctx,
    analyses,
    overall,
    role,
    level,
    categories: categoryRows = [],
    questionCount = analyses.length,
    durationMinutes = Math.max(12, questionCount * 3),
  } = params
  const first = firstNameFromFull(ctx.name)

  const catScore = (label) => {
    const row = categoryRows.find((c) => c.label === label)
    return row?.score ?? 0
  }
  const tagFor = (score) =>
    score >= 75 ? 'Strong' : score >= 50 ? 'Moderate' : score >= 25 ? 'Developing' : 'Needs work'
  const colorFor = (score) =>
    score >= 75 ? '#16a34a' : score >= 50 ? '#ea580c' : '#dc2626'

  const qaRows = analyses.map((a, i) => ({
    index: i + 1,
    topic: a.topic || 'Technical',
    question: a.question,
    accuracy: a.accuracy,
    clarity: a.clarity,
    understanding: a.understanding,
    depth: a.depth,
    total40: a.total40,
    stars: a.stars,
    feedback: a.feedback,
  }))

  const catMap = new Map()
  for (const a of analyses) {
    const cat = a.topic || 'Technical'
    const list = catMap.get(cat) || []
    list.push(a.score)
    catMap.set(cat, list)
  }
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((x, y) => x + y, 0) / arr.length) : overall)

  const commScore = catScore('Communication')
  const techScore = catScore('Technical')
  const problemScore = catScore('Problem Solving')
  const expScore = catScore('Experience')

  const donuts = [
    { label: 'Communication', score: commScore, tag: tagFor(commScore), color: colorFor(commScore) },
    { label: 'Technical', score: techScore, tag: tagFor(techScore), color: colorFor(techScore) },
    { label: 'Problem Solving', score: problemScore, tag: tagFor(problemScore), color: colorFor(problemScore) },
    { label: 'Experience', score: expScore, tag: tagFor(expScore), color: colorFor(expScore) },
    { label: 'Overall', score: overall, tag: tagFor(overall), color: colorFor(overall) },
  ]

  const healthMetrics = donuts.map((d, i) => ({
    label: d.label,
    icon: ['💬', '💻', '🧩', '📋', '🎯'][i] || '🎯',
    score: d.score,
    tag: d.tag,
    color: d.color,
  }))

  const careerScore = Math.min(980, Math.max(50, Math.round(overall * 10)))

  const radarAxes = [
    { label: 'Communication', val: commScore },
    { label: 'Technical', val: techScore },
    { label: 'Problem Solving', val: problemScore },
    { label: 'Experience', val: expScore },
    { label: 'Overall', val: overall },
  ]

  const careerPaths = [
    { role: `${role}`, match: Math.max(1, Math.min(99, overall)) },
    { role: `${role} (Senior)`, match: Math.max(1, Math.min(99, overall - 3)) },
    { role: 'Adjacent specialist', match: Math.max(1, Math.min(99, Math.round(overall * 0.92))) },
  ]

  const improvements = params.improvements || []
  const strengths = params.strengths || []

  const coachNotes = `${first}, your HireRight interview score is ${overall}/100 for ${role} (${level}). ${
    strengths[0] ? `Strength: ${strengths[0]}. ` : ''
  }${improvements[0] ? `Focus next: ${improvements[0]}. ` : ''}Job match percentages on your dashboard use this same score — retake the interview to improve.`

  return {
    careerScore,
    industryAlignment: Math.max(1, Math.min(99, overall)),
    donuts,
    healthMetrics,
    qaRows,
    radarAxes,
    careerPaths,
    starPatterns: qaRows.slice(0, 7).map((r) => ({
      name: r.topic,
      stars: r.stars,
      level: r.total40 >= 32 ? 'Strong' : r.total40 >= 24 ? 'Good' : 'Moderate',
    })),
    priorities: improvements.slice(0, 4).map((text, i) => ({
      num: i + 1,
      title: text.split('.')[0]?.slice(0, 60) || `Priority ${i + 1}`,
      text,
    })),
    coachNotes,
    sessionStats: {
      durationMinutes,
      questionCount,
      overallInterviewScore: overall,
      interviewType: `${role} · Adaptive AI Interview`,
    },
  }
}

export async function buildInterviewQuestions(profile, role, level, jobDescription = '', accountName = '') {
  const ctx = summarizeProfile(profile, accountName)
  const llm = await generateLlmQuestions(ctx, role, level, jobDescription)
  if (llm) {
    return { questions: llm, agent: 'llm', context: ctx }
  }
  return {
    questions: generateLocalQuestions(ctx, role, level, jobDescription),
    agent: 'hireright-agent',
    context: ctx,
  }
}

const STRUCTURE_SIGNALS = [
  'for example',
  'first',
  'then',
  'finally',
  'as a result',
  'because',
  'situation',
  'task',
  'action',
  'result',
  'so i',
  'which led',
  'in the end',
]

/**
 * @param {Question} question
 * @param {string} answer
 * @param {ReturnType<typeof summarizeProfile>} ctx
 */
function analyzeAnswer(question, answer, ctx) {
  const text = clean(answer)
  const lower = text.toLowerCase()
  const words = text.split(/\s+/).filter(Boolean)
  const wordCount = words.length

  let lengthScore = 0
  if (wordCount >= 10) lengthScore = 8
  if (wordCount >= 30) lengthScore = 16
  if (wordCount >= 60) lengthScore = 28
  if (wordCount > 280) lengthScore = 22

  const keywordsHit = (question.keywords || []).filter((k) => lower.includes(String(k).toLowerCase()))
  const keywordScore = Math.min(
    30,
    Math.round((keywordsHit.length / Math.min(Math.max(question.keywords.length, 1), 5)) * 30),
  )

  const structureHits = STRUCTURE_SIGNALS.filter((s) => lower.includes(s)).length
  const structureScore = Math.min(12, structureHits * 4)

  const hasNumbers = /\d/.test(text)
  const specificityScore =
    (hasNumbers ? 5 : 0) +
    (/\b(react|node|python|sql|aws|docker|typescript|java|kafka|figma|excel)\b/i.test(text) ? 5 : 0)

  // Resume fidelity — did they evidence claimed skills/employers?
  const skillsHit = ctx.skills.filter((s) => s.length >= 2 && lower.includes(s.toLowerCase()))
  const companyTokens = ctx.jobs
    .flatMap((j) => j.split(/[@:]/).map((p) => p.trim().toLowerCase()))
    .filter((t) => t.length >= 3 && !['role', 'company', 'at'].includes(t))
  const companiesHit = companyTokens.filter((t) => lower.includes(t))
  const resumeFit = Math.min(20, skillsHit.length * 3 + companiesHit.length * 4 + (ctx.resumeSnippet && wordCount > 40 ? 2 : 0))

  const score = Math.min(100, lengthScore + keywordScore + structureScore + specificityScore + resumeFit)

  let feedback
  if (wordCount < 12) {
    feedback = 'Too brief for a hiring interview. Aim for 60–150 words with a concrete example.'
  } else if (skillsHit.length === 0 && ctx.skills.length > 0) {
    feedback = `Connect the answer to skills on your resume (e.g. ${ctx.skills.slice(0, 3).join(', ')}).`
  } else if (structureHits === 0) {
    feedback = 'Good content — structure it as situation → action → result for clarity.'
  } else if (score >= 78) {
    feedback =
      skillsHit.length > 0
        ? `Strong, resume-aligned answer (referenced: ${skillsHit.slice(0, 2).join(', ')}).`
        : 'Strong answer — specific, structured, and relevant.'
  } else {
    feedback = 'Solid base. Add a measurable outcome and name tools from your profile.'
  }

  return {
    question: question.text,
    answer: text,
    score,
    wordCount,
    keywordsHit: unique([...keywordsHit, ...skillsHit]),
    feedback,
    resumeSkillsHit: skillsHit,
  }
}

/**
 * Optional LLM scoring pass (refines overall feedback).
 * @param {object} payload
 */
async function refineWithLlm(payload) {
  const apiKey =
    process.env.OPENROUTER_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.LLM_API_KEY
  if (!apiKey) return null

  const isOpenRouter =
    apiKey.startsWith('sk-or-') ||
    process.env.OPENAI_BASE_URL?.includes('openrouter')
  const base = (
    process.env.OPENAI_BASE_URL ||
    (isOpenRouter ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1')
  ).replace(/\/$/, '')
  const model =
    process.env.OPENAI_MODEL ||
    process.env.LLM_MODEL ||
    (isOpenRouter ? 'openrouter/free' : 'gpt-4o-mini')

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
  if (isOpenRouter) {
    headers['HTTP-Referer'] = 'http://localhost:5173'
    headers['X-Title'] = 'HIRERIGHTTT'
  }

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'You are Ava scoring a video interview for resume accuracy and communication. Return valid JSON only: {"overallAdjust":-5to5,"strengths":["..."],"improvements":["..."],"resumeFitSummary":"..."}',
          },
          { role: 'user', content: JSON.stringify(payload) },
        ],
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const text = data.choices?.[0]?.message?.content || ''
    const match = text.match(/\{[\s\S]*\}/)
    return match ? JSON.parse(match[0]) : null
  } catch {
    return null
  }
}

/**
 * @param {{
 *   role: string,
 *   level: string,
 *   questions: Question[],
 *   answers: string[],
 *   profile: ProfileContext,
 *   integrity?: { faceViolations?: number, singlePersonOk?: boolean, maxFacesSeen?: number }
 * }} input
 */
export async function scoreInterviewSession(input) {
  const ctx = summarizeProfile(input.profile, input.accountName || '')
  const analyses = input.questions.map((q, i) => analyzeAnswerDetailed(q, input.answers[i] || '', ctx))

  const byCategory = new Map()
  input.questions.forEach((q, i) => {
    const list = byCategory.get(q.category) || []
    list.push(analyses[i].score)
    byCategory.set(q.category, list)
  })

  const categories = CATEGORIES.map((label) => {
    const scores = byCategory.get(label)
    const score =
      scores && scores.length
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0
    return { label, score }
  })

  let overall = Math.round(analyses.reduce((a, b) => a + b.score, 0) / Math.max(analyses.length, 1))

  const joined = (input.answers || []).join(' ').toLowerCase()
  const skillsReferenced = ctx.skills.filter((s) => joined.includes(s.toLowerCase())).length
  let resumeFitScore = Math.min(
    100,
    Math.round(
      (skillsReferenced / Math.max(Math.min(ctx.skills.length, 5), 1)) * 70 +
        (analyses.reduce((a, b) => a + (b.resumeSkillsHit?.length || 0), 0) > 0 ? 20 : 0) +
        (ctx.jobs.some((j) => joined.includes(j.split('@')[0]?.toLowerCase?.() || '___never')) ? 10 : 0),
    ),
  )

  if (ctx.skills.length >= 3 && skillsReferenced >= 2) overall = Math.min(100, overall + 4)
  if (ctx.skills.length >= 3 && skillsReferenced === 0) overall = Math.max(0, overall - 5)

  const integrity = input.integrity || {}
  if (integrity.singlePersonOk === false) overall = Math.max(0, overall - 8)
  if ((integrity.faceViolations || 0) > 3) overall = Math.max(0, overall - 5)

  const strengths = []
  const improvements = []
  const avgWords = analyses.reduce((a, b) => a + b.wordCount, 0) / Math.max(analyses.length, 1)
  if (avgWords >= 50) strengths.push('Answers are detailed enough for a live hiring screen.')
  else improvements.push('Expand answers to roughly 60–150 words with concrete examples.')

  if (skillsReferenced >= 2) {
    strengths.push(
      `Resume alignment: you evidenced ${ctx.skills
        .filter((s) => joined.includes(s.toLowerCase()))
        .slice(0, 3)
        .join(', ')}.`,
    )
  } else if (ctx.skills.length) {
    improvements.push(`Reference skills from your resume (${ctx.skills.slice(0, 3).join(', ')}).`)
  }

  const best = [...categories].sort((a, b) => b.score - a.score)[0]
  const worst = [...categories].sort((a, b) => a.score - b.score)[0]
  if (best?.score >= 60) strengths.push(`${best.label} stands out (${best.score}/100).`)
  if (worst?.score < 60) improvements.push(`${worst.label} needs more practice (${worst.score}/100).`)

  if (integrity.singlePersonOk === false) {
    improvements.push('Keep exactly one person in frame — multi-person presence reduced integrity score.')
  }

  const llmRefine = await refineWithLlm({
    role: input.role,
    level: input.level,
    overall,
    resumeFitScore,
    categories,
    answers: analyses.map((a) => ({ question: a.question, score: a.score, feedback: a.feedback })),
    skills: ctx.skills,
  })

  if (llmRefine) {
    if (typeof llmRefine.overallAdjust === 'number') {
      overall = Math.max(0, Math.min(100, overall + Math.max(-5, Math.min(5, llmRefine.overallAdjust))))
    }
    if (Array.isArray(llmRefine.strengths)) strengths.push(...llmRefine.strengths.slice(0, 2))
    if (Array.isArray(llmRefine.improvements)) improvements.push(...llmRefine.improvements.slice(0, 2))
  }

  const strengthsOut = unique(strengths).slice(0, 6)
  const improvementsOut = unique(improvements).slice(0, 6)

  return {
    role: input.role,
    level: input.level,
    date: new Date().toISOString(),
    overall,
    resumeFitScore,
    categories,
    strengths: strengthsOut,
    improvements: improvementsOut,
    answers: analyses.map(({ resumeSkillsHit: _r, accuracy: _a, clarity: _c, understanding: _u, depth: _d, total40: _t, stars: _s, topic: _tp, ...rest }) => rest),
    scorecard: buildCareerScorecard({
      ctx,
      analyses,
      overall,
      categories,
      role: input.role,
      level: input.level,
      questionCount: input.questions.length,
      durationMinutes: input.durationMinutes || Math.max(12, input.questions.length * 4),
      strengths: strengthsOut,
      improvements: improvementsOut,
    }),
    integrity: {
      faceViolations: integrity.faceViolations || 0,
      singlePersonOk: integrity.singlePersonOk !== false,
      maxFacesSeen: integrity.maxFacesSeen || 1,
    },
    agent:
      process.env.OPENROUTER_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.LLM_API_KEY
        ? 'openrouter+hireright-agent'
        : 'hireright-agent',
  }
}

export function llmConfigured() {
  return Boolean(
    process.env.EXPERIENTIALLABS_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.LLM_API_KEY,
  )
}

/**
 * High-accuracy resume parsing using Google Gemini / LLM
 * @param {string} resumeText
 */
export async function parseResumeWithAI(resumeText) {
  if (!resumeText || !resumeText.trim()) return null
  const system =
    'You are an expert HR AI Resume Parser for HireRight. Extract structured profile information from this resume text into strictly valid JSON only.'
  const user = `Extract structured candidate profile information from this resume text into strictly valid JSON.

STRICT ANTI-HALLUCINATION RULES:
1. Extract ONLY information explicitly present in the provided resume text.
2. If the candidate is a fresher, student, or has NO formal professional work experience/employment listed in the resume, "workExperiences" MUST be an empty array [].
3. DO NOT convert academic/personal projects or university coursework into professional work experiences unless explicitly listed under a "Work Experience" / "Employment" section.
4. NEVER invent or hallucinate company names or job titles. NEVER output placeholder companies like "TechCitta", "Tech Solutions", "Company", "Acme", etc.
5. If no real companies are mentioned in the resume, return "workExperiences": [].
6. Under "certifications", extract technical certificates, licenses, or courses explicitly stated. If none exist in the resume, return "certifications": [].

JSON Schema:
{
  "fullName": "Full name of candidate",
  "currentRole": "Standardized job title matching industry roles (e.g. Full Stack Developer, Frontend Developer, Backend Developer, Software Engineer)",
  "totalExperience": "Standardized range (e.g. '0-1 Years', '1-3 Years', '3-5 Years', '5+ Years', '8+ Years')",
  "currentLocation": "City, Country or Remote",
  "skills": ["Array", "of", "technical", "skills", "tools", "languages"],
  "whoAreYou": "A polished 2-3 sentence executive summary introducing the candidate and their expertise",
  "whatDrivesYou": "A 1-2 sentence statement on what drives their engineering work and growth",
  "keyStrengths": "Top technical competencies and strengths",
  "experienceSummary": "Comprehensive summary of career accomplishments and engineering background",
  "workExperiences": [
    {
      "jobTitle": "Job Title",
      "company": "Company Name",
      "employmentType": "Full-time",
      "startDate": "YYYY-MM or Year",
      "endDate": "YYYY-MM or Present",
      "currentlyWorking": true,
      "location": "City, Country",
      "responsibilities": "Key impact and responsibilities"
    }
  ],
  "achievements": [
    "Key achievement 1",
    "Key achievement 2"
  ],
  "certifications": [
    {
      "name": "Certification or Course Name",
      "organization": "Issuing Organization or Platform",
      "dateEarned": "YYYY-MM or Year",
      "credentialId": "Credential ID"
    }
  ]
}

Resume Text:
${resumeText.slice(0, 12000)}`

  const llmResult = await callLlmApi({ system, user })
  if (!llmResult?.text) return null

  try {
    const cleaned = llmResult.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) return null
    let str = match[0]
    let parsed = null
    try {
      parsed = JSON.parse(str)
    } catch {
      str = str.replace(/,\s*([\}\]])/g, '$1')
      str = str.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (m) =>
        m.replace(/\r?\n/g, '\\n').replace(/\t/g, '\\t')
      )
      parsed = JSON.parse(str)
    }

    if (parsed && Array.isArray(parsed.workExperiences)) {
      parsed.workExperiences = parsed.workExperiences.filter((w) => {
        const comp = String(w?.company || '').trim()
        if (!comp || /^(company|techcitta|tech solutions|acme|unknown|n\/a|none|placeholder)$/i.test(comp)) {
          return false
        }
        const compClean = comp.toLowerCase().replace(/[^a-z0-9]/g, ' ')
        const compWords = compClean.split(/\s+/).filter((word) => word.length > 2)
        const isPresent = compWords.length > 0 && compWords.some((word) => resumeText.toLowerCase().includes(word))
        return isPresent
      })
    }

    if (parsed && Array.isArray(parsed.certifications)) {
      parsed.certifications = parsed.certifications
        .filter((c) => {
          const name = String(c?.name || '').trim()
          if (!name || name.length < 2) return false
          const nameClean = name.toLowerCase().replace(/[^a-z0-9]/g, ' ')
          const nameWords = nameClean.split(/\s+/).filter((word) => word.length > 2)
          return nameWords.length > 0 && nameWords.some((word) => resumeText.toLowerCase().includes(word))
        })
        .map((c, i) => ({
          id: c.id || `cert-${i + 1}-${Date.now().toString(36)}`,
          name: String(c.name || '').slice(0, 100),
          organization: String(c.organization || '').slice(0, 100),
          dateEarned: String(c.dateEarned || ''),
          credentialId: String(c.credentialId || '').slice(0, 60),
        }))
    }

    return parsed
  } catch (err) {
    console.warn('[InterviewAgent] Resume JSON parse error:', err)
    return null
  }
}
