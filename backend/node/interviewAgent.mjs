/**
 * HIRERIGHT Interview Agent
 * Generates resume-accurate questions and scores answers.
 * Uses OpenAI when OPENAI_API_KEY / LLM_API_KEY is set; otherwise a strong local agent.
 */

import { geminiApiConfigured, isGeminiProvider, modelCascadeForTier } from './llmModels.mjs'
import { geminiChat, resolveGeminiApiKey, isGeminiAuthKey } from './geminiClient.mjs'
import { computeFinalAtsScore, parseResumeStructure } from './atsScorer.mjs'
import { extractPrimarySkillsFromJd, computeAtsScore } from './vendor/atsScore.mjs'

export const INTERVIEW_TURN_COUNT = 6
export { publicModelConfig, geminiKeyFormatWarning } from './llmModels.mjs'

export const CATEGORIES = ['Communication', 'Technical', 'Problem Solving', 'Experience']

/** Session scorecard: three weighted rubrics (0–100 each). Question score = weighted sum. */
export const INTERVIEW_RUBRICS = [
  { id: 'evidence', label: 'Evidence & Relevance', weight: 0.4 },
  { id: 'structure', label: 'Structure & Clarity', weight: 0.35 },
  { id: 'impact', label: 'Impact & Specificity', weight: 0.25 },
]

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

function isDemoPlaceholderName(name) {
  const t = clean(name)
  if (!t) return false
  return t === DEMO_ACCOUNT_NAME || /^arjun\s+sharma$/i.test(t)
}

/**
 * Prefer resume / profile name over generic demo account labels.
 * @param {ProfileContext} profile
 * @param {string} [accountName]
 */
export function resolveCandidateName(profile = {}, accountName = '') {
  const fromProfile = clean(profile.fullName) || clean(profile.name)
  if (fromProfile && !isDemoPlaceholderName(fromProfile)) return fromProfile

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

  const acct = clean(accountName)
  if (acct && !isDemoPlaceholderName(acct)) return acct
  return 'Candidate'
}

/** @param {string} full */
export function firstNameFromFull(full) {
  const n = clean(full)
  if (!n || n === 'Candidate' || isDemoPlaceholderName(n)) return 'there'
  return n.split(/\s+/)[0]
}

/** @param {ProfileContext} profile */
export function summarizeProfile(profile = {}, accountName = '') {
  const resolvedName = resolveCandidateName(profile, accountName)
  const skills = unique((profile.skills || []).map((s) => clean(s))).slice(0, 16)
  const jobs = (profile.workExperiences || [])
    .filter((w) => w?.jobTitle || w?.company)
    .slice(0, 4)
    .map((w) => {
      const detail = clean(w.description || w.responsibilities)
      return `${clean(w.jobTitle) || 'Role'} @ ${clean(w.company) || 'Company'}${detail ? `: ${detail.slice(0, 180)}` : ''}`
    })
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

  return questions.slice(0, 5)
}

function isFresherExperienceLevel(level) {
  const l = clean(level).toLowerCase().replace(/\s+/g, ' ')
  return (
    l.includes('fresher') ||
    l.includes('0-1') ||
    l.includes('0–1') ||
    l.includes('0 to 1') ||
    l.includes('intern') ||
    l.includes('student') ||
    l.includes('campus')
  )
}


function skillDisplayLabel(jdSkills, key) {
  const k = String(key || '').toLowerCase()
  return jdSkills.find((s) => s.toLowerCase() === k) || k.replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Extract JD skills and résumé overlap before building employer interview questions.
 */
export function analyzeInterviewSkillMatch({ jobDescription, requiredSkills, profile, ctx }) {
  const resumeText = String(profile?.resumeText || ctx?.resumeSnippet || '')
  const jd = String(jobDescription || '')
  const jdSkills = extractPrimarySkillsFromJd(jd, requiredSkills || [])
  const parsedResume = parseResumeStructure(resumeText)
  for (const s of jdSkills) {
    const n = String(s).toLowerCase()
    if (!parsedResume.skills.some((x) => x === n || x.includes(n))) parsedResume.skills.push(n)
  }
  const requiredSet = new Set((requiredSkills || []).map((s) => String(s).toLowerCase()))
  const preferred = jdSkills.filter((s) => !requiredSet.has(String(s).toLowerCase())).slice(0, 12)
  const hybrid = computeFinalAtsScore({
    rawResumeText: resumeText,
    parsedResume,
    jobDescription: {
      requiredSkills: requiredSkills?.length ? requiredSkills : jdSkills,
      preferredSkills: preferred,
    },
    llmEvaluation: {
      semanticProjectScore: 70,
      experienceScore: 75,
      educationScore: 85,
    },
  })
  const legacy = computeAtsScore({ jobDescription: jd, resumeText, requiredSkills: jdSkills })
  return {
    jdSkills,
    matchedSkills: hybrid.matchedSkills.map((m) => skillDisplayLabel(jdSkills, m)),
    missingSkills: hybrid.missingSkills.map((m) => skillDisplayLabel(jdSkills, m)),
    atsScore: hybrid.overallScore,
    jdMatchScore: hybrid.jdMatchScore ?? legacy.jdMatchScore,
    resumeSkillCoverage: hybrid.resumeSkillCoverage ?? legacy.resumeSkillCoverage,
    atsBreakdown: hybrid.breakdown,
  }
}

/** @param {{ applicationId?: string, jobId?: string, jobDescription?: string, requiredSkills?: string[], mode?: string }} options */
export function resolveInterviewQuestionMode(options = {}) {
  if (options.mode === 'vendor_jd') return 'vendor_jd'
  if (options.mode === 'resume_only') return 'resume_only'
  if (options.mode === 'employer' || options.applicationId || options.jobId) return 'employer'
  if (options.mode === 'individual_jd') return 'individual_jd'
  return 'resume_only'
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
/**
 * @param {{ system: string, user: string, temperature?: number, tier?: 'quality' | 'fast', maxTokens?: number }} opts
 */
export async function callLlmApi({ system, user, temperature = 0.3, tier = 'quality', maxTokens }) {
  const apiKey = resolveGeminiApiKey()
  if (!apiKey) return null

  const isGemini = isGeminiProvider()
  const candidateModels = modelCascadeForTier(tier)

  for (let i = 0; i < candidateModels.length; i++) {
    const { name: currentModel, label } = candidateModels[i]
    try {
      if (isGemini) {
        const result = await geminiChat({
          apiKey,
          model: currentModel,
          system,
          user,
          temperature,
          maxTokens,
        })
        if (result.ok && result.text.trim()) {
          console.log(
            `🔥 [${label}${isGeminiAuthKey(apiKey) ? ' native' : ''}] Success! Prompt tokens: ${result.tokenUsage.promptTokens} | Completion: ${result.tokenUsage.completionTokens} | Total: ${result.tokenUsage.totalTokens}`,
          )
          return {
            text: result.text,
            tokenUsage: result.tokenUsage,
            provider: label,
            model: currentModel,
          }
        }
        console.warn(
          `[LLM Fallback Trigger] Model "${currentModel}" status ${result.status}. Falling back...`,
          result.error?.slice(0, 160),
        )
        continue
      }

      const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:5173',
        'X-Title': 'HIRERIGHTTT',
      }
      const body = {
        model: currentModel,
        temperature,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }
      if (typeof maxTokens === 'number' && maxTokens > 0) {
        body.max_tokens = maxTokens
      }
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
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
          console.log(
            `🔥 [${label}] Success! Prompt tokens: ${tokenUsage.promptTokens} | Completion: ${tokenUsage.completionTokens} | Total: ${tokenUsage.totalTokens}`,
          )
          return { text, tokenUsage, provider: label, model: currentModel }
        }
      }

      const errText = await res.text().catch(() => '')
      console.warn(
        `[LLM Fallback Trigger] Model "${currentModel}" status ${res.status}. Falling back to next model...`,
        errText.slice(0, 160),
      )
    } catch (err) {
      console.warn(`[LLM Fallback Trigger] Model "${currentModel}" error: ${err.message}. Falling back...`)
    }
  }

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

  const llmResult = await callLlmApi({ system, user, temperature: 0.35, tier: 'quality' })
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

  const llm = await callLlmApi({
    system,
    user,
    temperature: 0.4,
    tier: 'fast',
    maxTokens: 120,
  })
  if (llm?.text) {
    try {
      const match = llm.text.match(/\{[\s\S]*\}/)
      if (match) {
        const parsed = JSON.parse(match[0])
        const spoken = clean(parsed.spoken)
        if (spoken.length > 8) {
          return { spoken, interactive: true, agent: llm.model || llm.provider || 'llm' }
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

/** Address the candidate without inventing a name. `there` means speak with "you". */
function spokenLead(first, clause) {
  const body = clean(clause)
  if (!body) return ''
  if (!first || first === 'there') return body.charAt(0).toUpperCase() + body.slice(1)
  return `${first}, ${body}`
}

function isSeniorExperienceLevel(level) {
  const l = clean(level).toLowerCase()
  if (/\b(senior|lead|principal|staff|architect|director)\b/.test(l)) return true
  const range = l.match(/(\d+)\s*[-–]\s*(\d+)/)
  if (range) return Number(range[2]) >= 5
  const plus = l.match(/(\d+)\s*\+/)
  if (plus) return Number(plus[1]) >= 5
  const years = l.match(/(\d+)\s*(?:years?|yrs?)/)
  if (years) return Number(years[1]) >= 5
  return false
}

function isThinAnswer(text) {
  return clean(text).split(/\s+/).filter(Boolean).length < 12
}

function questionMentions(history, label) {
  const key = clean(label).toLowerCase()
  if (key.length < 2) return false
  return (history || []).some((h) => {
    const text = clean(h.question?.text || h.question).toLowerCase()
    const topic = clean(h.question?.topic).toLowerCase()
    return topic === key || text.includes(key)
  })
}

/**
 * Spec §2.4 patterns. Full-stack, math, or a concrete skill claim in `{role}` context.
 * @param {string} first
 * @param {string} skill
 * @param {string} role
 */
function buildClaimedSkillQuestion(first, skill, role) {
  const fullStackLike = /full[\s-]?stack|mern|mean/i.test(skill)
  const mathLike = /math|statistic|calculus|algebra|geometry/i.test(skill)
  if (fullStackLike) {
    return spokenLead(
      first,
      `you said you're good at ${skill}. Pick one real product feature and walk me through it end to end — client/UI, APIs or services, database, auth if any, and how you tested and shipped it.`,
    )
  }
  if (mathLike) {
    return spokenLead(
      first,
      `you said you're strong in ${skill}. Walk me through a problem you solved with ${skill} — setup, method, and how you verified the result.`,
    )
  }
  const roleBit = role ? ` in a ${role} context` : ''
  return spokenLead(
    first,
    `you mentioned ${skill}. Describe a concrete situation where you applied ${skill}${roleBit} — challenge, actions, and outcome.`,
  )
}

function buildFirstAdaptiveQuestionLocal(first, role, level, ctx) {
  const fresher = isFresherExperienceLevel(level)
  if (fresher) {
    return {
      text: ctx.resumeSnippet
        ? spokenLead(
            first,
            `you're interviewing for ${role} as a ${level} candidate. Walk me through yourself — education, projects or internships, and strengths from your résumé that fit this role.`,
          )
        : spokenLead(
            first,
            `tell me about yourself for ${role} — your background, what you've built or learned, and why this field fits you.`,
          ),
      category: 'Communication',
      keywords: unique(['education', 'project', 'intern', 'skill', 'learn', role.toLowerCase()]),
      hint: 'About a minute: who you are, one project, skills for this role.',
      topic: 'Introduction',
      focus: 'fresher-intro',
    }
  }
  const job = ctx.jobs?.[0] || ''
  const jobHead = job.split(':')[0]?.trim() || job
  return {
    text: jobHead
      ? spokenLead(
          first,
          `for this ${role} interview (${level}), start with your industry experience — especially ${jobHead}. What did you own, and what impact did you create?`,
        )
      : ctx.resumeSnippet
        ? spokenLead(
            first,
            `I've reviewed your résumé for ${role} (${level}). Walk me through your professional experience — roles, industry context, and outcomes you're proud of.`,
          )
        : spokenLead(
            first,
            `describe your industry experience for ${role} (${level}) — responsibilities and measurable results.`,
          ),
    category: 'Experience',
    keywords: unique(['experience', 'impact', 'role', 'team', role.toLowerCase()]),
    hint: 'Use real employers, timelines, and results from your résumé.',
    topic: jobHead || 'Industry experience',
    resumeAnchor: jobHead || undefined,
    focus: 'experienced-intro',
  }
}

function buildResumeTopicQuestion(first, role, level, topic) {
  const label = topic.label
  const fresher = isFresherExperienceLevel(level)
  const senior = isSeniorExperienceLevel(level)
  let text
  let category = 'Experience'
  if (fresher) {
    text = spokenLead(
      first,
      `on your background I see ${label}. Walk me through what you built or learned, the tools you used, and how you checked that it worked.`,
    )
    category = 'Experience'
  } else if (senior) {
    text = spokenLead(
      first,
      `looking at ${label}: what did you own, which trade-offs did you accept, and what outcome did that create?`,
    )
    category = 'Problem Solving'
  } else {
    text = spokenLead(
      first,
      `on your background I see ${label}. Walk me through your responsibility, a hard decision, and the outcome.`,
    )
  }
  return {
    text,
    category,
    keywords: unique([String(label).toLowerCase().slice(0, 48), 'outcome', role.toLowerCase()]),
    hint: 'Use only details that are actually on your résumé.',
    topic: topic.topic || label,
    resumeAnchor: label,
    focus: 'adaptive-local',
  }
}

function nextResumeSkillInJobDescription(jobDescription, ctx, history) {
  const jd = clean(jobDescription).toLowerCase()
  if (!jd) return ''
  const snippet = clean(ctx.resumeSnippet).toLowerCase()
  for (const skill of ctx.skills || []) {
    const s = clean(skill)
    if (s.length < 2) continue
    const key = s.toLowerCase()
    if (!jd.includes(key)) continue
    if (!snippet.includes(key) && !(ctx.skills || []).some((x) => clean(x).toLowerCase() === key)) continue
    if (questionMentions(history, s)) continue
    return s
  }
  return ''
}

function buildLevelFallbackQuestion(first, role, level, turnNumber) {
  const fresher = isFresherExperienceLevel(level)
  const senior = isSeniorExperienceLevel(level)
  if (turnNumber >= INTERVIEW_TURN_COUNT) {
    return spokenLead(
      first,
      `why is this ${role} role a fit for you now, and what is one strength from your own experience we should remember?`,
    )
  }
  if (fresher) {
    return spokenLead(
      first,
      `pick a project or class from your own background for ${role}. What did you build or learn, and how did you check that it worked?`,
    )
  }
  if (senior) {
    return spokenLead(
      first,
      `describe a decision you owned in ${role} work — the options, the trade-off you accepted, and the result.`,
    )
  }
  return spokenLead(
    first,
    `describe a concrete situation from your own experience in ${role} — the challenge, the actions you took, and the outcome.`,
  )
}

/**
 * Parse + validate one LLM question (see repo `question-generation.md` §3).
 * @param {object} raw
 * @param {string[]} priorTexts
 */
function normalizeAdaptiveQuestion(raw, priorTexts = []) {
  const text = clean(raw.text)
  if (text.length < 24) return null
  if (priorTexts.some((p) => p === text || p.slice(0, 40) === text.slice(0, 40))) return null
  return {
    text,
    category: CATEGORIES.includes(raw.category) ? raw.category : 'Technical',
    keywords: unique((raw.keywords || []).map((k) => clean(k).toLowerCase())).slice(0, 12),
    hint: clean(raw.hint) || 'Give a concrete example with tools and outcome.',
    topic: clean(raw.topic) || clean(raw.category) || 'Interview',
    resumeAnchor: clean(raw.resumeAnchor) || undefined,
    focus: 'adaptive-llm',
  }
}

/** @param {{ turnNumber: number, role: string, level: string, first: string }} p */
function buildAdaptiveQuestionSystemPrompt(p) {
  const nameRule =
    p.first === 'there'
      ? 'Do NOT use fake names (no Arjun, no Candidate). Start neutrally or with "you".'
      : `You may use the first name "${p.first}" once if natural.`
  const jdAttached = String(p.jobDescription || '').trim().length >= 40
  const jdRule = jdAttached
    ? `- EMPLOYER JOB DESCRIPTION IS ATTACHED: Every question must reference a specific requirement, responsibility, tech stack item, or deliverable from that JD (paraphrase is fine). Do not ask generic trivia unrelated to the JD.`
    : ''
  return `You are Ava, a realistic professional interviewer on a live video call. Generate exactly ONE new interview question (JSON only).

Rules:
- This is question ${p.turnNumber} of ${INTERVIEW_TURN_COUNT}. Never repeat or lightly rephrase any prior question.
- Use the candidate resume, role "${p.role}", experience "${p.level}", job description (if any), and their last answer to choose the next realistic topic.
- One clear idea per question — how a real hiring manager speaks.
- ${nameRule}
- Do not invent employers, degrees, or projects absent from the resume snippet.
- category must be one of: Communication, Technical, Problem Solving, Experience.
${jdRule}

Return ONLY: {"question":{"text":"...","category":"...","keywords":["..."],"hint":"...","topic":"...","resumeAnchor":"optional"}}`
}

/** @param {object} p */
function buildAdaptiveQuestionUserPayload(p) {
  return JSON.stringify({
    turnNumber: p.turnNumber,
    totalTurns: INTERVIEW_TURN_COUNT,
    roleTrack: p.role,
    experienceLevel: p.level,
    jobDescription: p.jobDescription || null,
    candidateSummary: {
      skills: (p.ctx.skills || []).slice(0, 16),
      jobs: (p.ctx.jobs || []).slice(0, 4),
      achievements: (p.ctx.achievements || []).slice(0, 5),
      resumeSnippet: (p.ctx.resumeSnippet || '').slice(0, 2800),
    },
    priorQuestions: p.priorTexts,
    lastAnswer: p.lastAnswer || null,
  })
}

/**
 * Same decision order as question-generation.md when Gemini is unavailable:
 * one question, no invented employers, follow the last answer, never repeat.
 * @param {object} input
 */
export function generateAdaptiveQuestionLocal(input) {
  const ctx = input.ctx || summarizeProfile(input.profile || {}, input.accountName || '')
  const role = input.role || 'Full Stack Engineer'
  const level = input.level || '1–3 years'
  const jobDescription = clean(input.jobDescription)
  const history = Array.isArray(input.history) ? input.history : []
  const lastAnswer = clean(input.lastAnswer)
  const priorTexts = history.map((h) => clean(h.question?.text || h.question)).filter(Boolean)
  const first = firstNameFromFull(ctx.name)
  const turnNumber = history.length + 1

  /** @type {object[]} */
  const candidates = []
  if (history.length === 0) {
    if (jobDescription.trim().length >= 40) {
      const jdSkill =
        nextResumeSkillInJobDescription(jobDescription, ctx, history) ||
        extractPrimarySkillsFromJd(jobDescription, [])[0] ||
        ''
      if (jdSkill) {
        candidates.push({
          text: spokenLead(
            first,
            `this role's job description highlights ${jdSkill}. Walk me through a real example where you used ${jdSkill} for ${role} work — situation, what you did, and the outcome.`,
          ),
          category: 'Technical',
          keywords: unique([String(jdSkill).toLowerCase(), 'jd', role.toLowerCase(), 'outcome']),
          hint: 'Tie your answer to the employer JD requirement.',
          topic: String(jdSkill),
          focus: 'jd-first',
        })
      }
    }
    candidates.push(buildFirstAdaptiveQuestionLocal(first, role, level, ctx))
  } else {
    const claimed = extractClaimedSkills(lastAnswer).filter((skill) => !questionMentions(history, skill))
    if (claimed[0]) {
      const skill = claimed[0]
      const fullStackLike = /full[\s-]?stack|mern|mean/i.test(skill)
      const mathLike = /math|statistic|calculus|algebra|geometry/i.test(skill)
      candidates.push({
        text: buildClaimedSkillQuestion(first, skill, role),
        category: fullStackLike || mathLike ? 'Technical' : 'Experience',
        keywords: unique([skill.toLowerCase(), 'example', 'outcome', role.toLowerCase()]),
        hint: 'Give a concrete example with tools and outcome.',
        topic: skill,
        focus: 'adaptive-local',
      })
    }
    if (!claimed[0] || isThinAnswer(lastAnswer)) {
      const topic = pickResumeTopicFromCtx(ctx, history)
      if (topic && !questionMentions(history, topic.label)) {
        candidates.push(buildResumeTopicQuestion(first, role, level, topic))
      }
    }
    const jdSkill = nextResumeSkillInJobDescription(jobDescription, ctx, history)
    if (jdSkill) {
      candidates.push({
        text: spokenLead(
          first,
          `your résumé lists ${jdSkill}, and this role asks for it. Describe a concrete situation where you applied ${jdSkill} in a ${role} context — challenge, actions, and outcome.`,
        ),
        category: 'Technical',
        keywords: unique([jdSkill.toLowerCase(), 'example', 'outcome', role.toLowerCase()]),
        hint: 'Give a concrete example with tools and outcome.',
        topic: jdSkill,
        resumeAnchor: jdSkill,
        focus: 'adaptive-local',
      })
    }
  }

  const fallbackCategory = turnNumber >= INTERVIEW_TURN_COUNT ? 'Communication' : 'Problem Solving'
  candidates.push({
    text: buildLevelFallbackQuestion(first, role, level, turnNumber),
    category: fallbackCategory,
    keywords: unique(['experience', 'outcome', role.toLowerCase()]),
    hint: 'Give a concrete example with tools and outcome.',
    topic: turnNumber >= INTERVIEW_TURN_COUNT ? 'Closing' : 'Interview',
    focus: 'adaptive-local',
  })
  candidates.push({
    text: spokenLead(
      first,
      `for question ${turnNumber} of ${INTERVIEW_TURN_COUNT}, describe a result you personally produced for ${role} work — what you did and how you knew it worked.`,
    ),
    category: 'Experience',
    keywords: unique(['result', role.toLowerCase()]),
    hint: 'Give a concrete example with tools and outcome.',
    topic: `Turn ${turnNumber}`,
    focus: 'adaptive-local',
  })

  for (const raw of candidates) {
    const q = normalizeAdaptiveQuestion(raw, priorTexts)
    if (!q) continue
    return { ...q, focus: raw.focus || 'adaptive-local' }
  }

  return {
    text: spokenLead(
      first,
      `tell me about work you actually did for ${role}. Include the situation, what you did, and the result. This is question ${turnNumber}.`,
    ),
    category: 'Experience',
    keywords: unique(['experience', role.toLowerCase()]),
    hint: 'Give a concrete example with tools and outcome.',
    topic: `Turn ${turnNumber}`,
    focus: 'adaptive-local',
  }
}

/**
 * One question per turn. Uses the quality-tier LLM when Gemini is configured,
 * otherwise the same local rules in `generateAdaptiveQuestionLocal`.
 * Spec: `question-generation.md` §2–3 and §6.
 * @param {object} input
 */
export async function generateAdaptiveQuestion(input) {
  const ctx = input.ctx || summarizeProfile(input.profile || {}, input.accountName || '')
  const role = input.role || 'Full Stack Engineer'
  const level = input.level || '1–3 years'
  const jobDescription = clean(input.jobDescription)
  const history = Array.isArray(input.history) ? input.history : []
  const lastAnswer = clean(input.lastAnswer)
  const turnNumber = history.length + 1
  const priorTexts = history.map((h) => clean(h.question?.text || h.question)).filter(Boolean)
  const first = firstNameFromFull(ctx.name)
  const localInput = { ...input, ctx, role, level, jobDescription, history, lastAnswer }

  if (!llmConfigured()) return generateAdaptiveQuestionLocal(localInput)

  const system = buildAdaptiveQuestionSystemPrompt({
    turnNumber,
    role,
    level,
    first,
    jobDescription,
  })
  const user = buildAdaptiveQuestionUserPayload({
    turnNumber,
    role,
    level,
    jobDescription,
    ctx,
    priorTexts,
    lastAnswer,
  })

  for (const temperature of [0.62, 0.42]) {
    const llm = await callLlmApi({ system, user, temperature, tier: 'quality' })
    if (!llm?.text) continue
    try {
      const match = llm.text.match(/\{[\s\S]*\}/)
      if (!match) continue
      const parsed = JSON.parse(match[0])
      const q = normalizeAdaptiveQuestion(parsed.question || parsed, priorTexts)
      if (q) return q
    } catch {
      // retry other temperature
    }
  }

  return generateAdaptiveQuestionLocal(localInput)
}

function wordCountBandScore(wordCount) {
  if (wordCount < 8) return 15
  if (wordCount < 25) return 45
  if (wordCount < 45) return 72
  if (wordCount <= 180) return 100
  if (wordCount <= 260) return 78
  return 55
}

function stdDev(values) {
  if (!values.length) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
  return Math.round(Math.sqrt(variance) * 10) / 10
}

function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

/**
 * @param {Question} question
 * @param {string} answer
 * @param {ReturnType<typeof summarizeProfile>} ctx
 */
function computeRubricScores(question, answer, ctx) {
  const text = clean(answer)
  const lower = text.toLowerCase()
  const words = text.split(/\s+/).filter(Boolean)
  const wordCount = words.length

  const keywords = (question.keywords || []).map((k) => String(k).toLowerCase()).filter(Boolean)
  const keywordsHit = keywords.filter((k) => lower.includes(k))
  const keywordCoverage =
    keywords.length > 0
      ? Math.round((keywordsHit.length / Math.min(keywords.length, 6)) * 100)
      : wordCount >= 20
        ? 70
        : 35

  const skillsHit = ctx.skills.filter((s) => s.length >= 2 && lower.includes(s.toLowerCase()))
  const companyTokens = ctx.jobs
    .flatMap((j) => j.split(/[@:]/).map((p) => p.trim().toLowerCase()))
    .filter((t) => t.length >= 3 && !['role', 'company', 'at'].includes(t))
  const companiesHit = companyTokens.filter((t) => lower.includes(t))
  const resumeEvidence = Math.min(
    100,
    Math.round(skillsHit.length * 22 + companiesHit.length * 28 + (ctx.resumeSnippet && wordCount > 35 ? 12 : 0)),
  )

  const evidence = Math.min(100, Math.round(keywordCoverage * 0.55 + resumeEvidence * 0.45))

  const structureHits = STRUCTURE_SIGNALS.filter((s) => lower.includes(s)).length
  const structureSignals = Math.min(100, Math.round((structureHits / 3) * 100))
  const clarityBand = wordCountBandScore(wordCount)
  const fillerPenalty = /\b(um+|uh+|like,|you know)\b/i.test(text) ? 8 : 0
  const structure = Math.max(0, Math.min(100, Math.round(clarityBand * 0.6 + structureSignals * 0.4 - fillerPenalty)))

  const hasNumbers = /\d/.test(text)
  const hasMetrics = /\b(\d+\s*%|\$\d|percent|increase|reduce|saved|improved|latency|throughput)\b/i.test(text)
  const hasTools =
    /\b(react|node|python|sql|aws|docker|typescript|java|kafka|postgres|kubernetes|api|microservice)\b/i.test(
      text,
    )
  const outcomeWords = (text.match(/\b(built|shipped|led|fixed|designed|implemented|delivered|migrated)\b/gi) || [])
    .length
  let impact = 25
  if (hasNumbers) impact += 28
  if (hasMetrics) impact += 18
  if (hasTools) impact += 14
  impact += Math.min(15, outcomeWords * 5)
  impact = Math.min(100, impact)

  const rubricMap = { evidence, structure, impact }
  const rubrics = INTERVIEW_RUBRICS.map((r) => ({
    id: r.id,
    label: r.label,
    weight: r.weight,
    score: rubricMap[r.id] ?? 0,
  }))
  const questionScore = Math.min(
    100,
    Math.round(rubrics.reduce((sum, r) => sum + r.score * r.weight, 0)),
  )

  return { rubrics, questionScore, wordCount, keywordsHit: unique([...keywordsHit, ...skillsHit]), skillsHit }
}

function analyzeAnswerDetailed(question, answer, ctx) {
  const base = analyzeAnswer(question, answer, ctx)
  const { rubrics, questionScore, wordCount, keywordsHit, skillsHit } = computeRubricScores(
    question,
    answer,
    ctx,
  )
  const performance =
    questionScore >= 80 ? 'Strong' : questionScore >= 65 ? 'Good' : questionScore >= 45 ? 'Fair' : 'Needs work'
  return {
    ...base,
    score: questionScore,
    wordCount,
    keywordsHit,
    resumeSkillsHit: skillsHit,
    topic: question.topic || question.category || 'Interview',
    rubrics,
    performance,
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

  void categoryRows
  const tagFor = (score) =>
    score >= 75 ? 'Strong' : score >= 50 ? 'Moderate' : score >= 25 ? 'Developing' : 'Needs work'
  const colorFor = (score) =>
    score >= 75 ? '#16a34a' : score >= 50 ? '#ea580c' : '#dc2626'

  const qaRows = analyses.map((a, i) => ({
    index: i + 1,
    topic: a.topic || 'Interview',
    question: a.question,
    score: a.score,
    rubrics: (a.rubrics || []).map((r) => ({ label: r.label, score: r.score, weight: r.weight })),
    performance: a.performance || tagFor(a.score),
    feedback: a.feedback,
  }))

  const rubricTotals = new Map(INTERVIEW_RUBRICS.map((r) => [r.id, []]))
  for (const a of analyses) {
    for (const r of a.rubrics || []) {
      const list = rubricTotals.get(r.id) || []
      list.push(r.score)
      rubricTotals.set(r.id, list)
    }
  }
  const rubricSessionScores = INTERVIEW_RUBRICS.map((def) => {
    const scores = rubricTotals.get(def.id) || []
    const score = scores.length
      ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length)
      : 0
    return { label: def.label, score, weight: def.weight }
  })

  const donuts = rubricSessionScores.map((r) => ({
    label: r.label,
    score: r.score,
    tag: tagFor(r.score),
    color: colorFor(r.score),
  }))

  const healthMetrics = donuts.map((d, i) => ({
    label: d.label,
    icon: ['📎', '🧭', '📈'][i] || '🎯',
    score: d.score,
    tag: d.tag,
    color: d.color,
  }))

  const careerScore = Math.min(980, Math.max(50, Math.round(overall * 10)))

  const radarAxes = [
    ...rubricSessionScores.map((r) => ({ label: r.label, val: r.score })),
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
      name: `Q${r.index}`,
      stars: '★'.repeat(Math.max(1, Math.round(r.score / 20))).padEnd(5, '☆'),
      level: r.performance,
    })),
    rubricWeights: INTERVIEW_RUBRICS.map((r) => ({ label: r.label, weight: r.weight })),
    statistics: params.statistics,
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

  const questionScores = analyses.map((a) => a.score)
  let overall = Math.round(questionScores.reduce((a, b) => a + b, 0) / Math.max(questionScores.length, 1))

  const rubricAgg = new Map(INTERVIEW_RUBRICS.map((r) => [r.id, []]))
  for (const a of analyses) {
    for (const r of a.rubrics || []) {
      rubricAgg.get(r.id)?.push(r.score)
    }
  }
  const categories = INTERVIEW_RUBRICS.map((def) => {
    const scores = rubricAgg.get(def.id) || []
    const score = scores.length
      ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length)
      : 0
    return { label: def.label, score, weight: def.weight }
  })

  const statistics = {
    questionCount: analyses.length,
    meanQuestionScore: overall,
    medianQuestionScore: median(questionScores),
    stdDevQuestionScore: stdDev(questionScores),
    minQuestionScore: questionScores.length ? Math.min(...questionScores) : 0,
    maxQuestionScore: questionScores.length ? Math.max(...questionScores) : 0,
    meanWordCount: Math.round(analyses.reduce((a, b) => a + b.wordCount, 0) / Math.max(analyses.length, 1)),
  }

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
  // Camera telemetry is not evidence of job competence and must not alter scores.

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
  if (best?.score >= 60) strengths.push(`${best.label} is your strongest rubric (${best.score}/100).`)
  if (worst?.score < 60) improvements.push(`Strengthen ${worst.label} (${worst.score}/100) with clearer examples and outcomes.`)

  const weakQuestions = analyses.filter((a) => a.score < 50).length
  if (weakQuestions > 0) {
    improvements.push(`${weakQuestions} answer(s) scored below 50 — add evidence and measurable results.`)
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
    answers: analyses.map(({ resumeSkillsHit: _r, ...rest }) => rest),
    statistics,
    rubricWeights: INTERVIEW_RUBRICS.map((r) => ({ label: r.label, weight: r.weight })),
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
      statistics,
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

const INTERACTIVE_FLOW = {
  version: 4,
  voice: { preferredName: 'Jessica', language: 'en-IN', rate: 0.94 },
  steps: [
    {
      id: 'day_check',
      spokenTemplate: "Hi {firstName}, I'm Ava. How has your day been so far?",
      minResponseChars: 1,
      advanceMode: 'response_or_next',
      nextStep: 'confirm_begin',
    },
    {
      id: 'confirm_begin',
      spokenTemplate:
        "Thanks, {firstName}. Let's begin your {role} interview — I'll ask about your background and résumé. Say yes when you're ready for the first question.",
      minResponseChars: 1,
      advanceMode: 'affirmative_or_next',
      nextStep: 'questions',
      onAdvanceAction: 'start_questions',
      notReadyTemplate:
        'No problem, {firstName}. Say yes when you want the first question.',
    },
  ],
  commands: {
    next_question: [
      'next question',
      'next one',
      'move on',
      'go ahead',
      'continue',
      'skip',
      'next please',
      'agla question',
      'next ques',
    ],
    affirmative: [
      'yes',
      'yeah',
      'yep',
      'sure',
      'ok',
      'okay',
      'ready',
      "let's go",
      'lets go',
      'start',
      'begin',
      'absolutely',
      'please do',
      'go for it',
      'haan',
      'ha',
      'correct',
      'clear',
      'i can hear',
      'hear you',
      'fine',
      'good',
      'great',
      'doing well',
      'i am good',
      'im good',
    ],
    repeat_last: [
      'repeat',
      'say again',
      "can't hear",
      'cant hear',
      "didn't hear",
      'didnt hear',
      'come again',
      'pardon',
      'what did you say',
      'please repeat',
    ],
    speak_slower: ['speak slower', 'slow down', 'too fast', 'speak slowly', 'little slower'],
    take_moment: [
      'take a moment',
      'give me a second',
      'one moment',
      'wait',
      'hold on',
      'just a minute',
    ],
  },
}

function normalizeInteractiveText(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function matchesInteractivePatterns(text, patterns) {
  const n = normalizeInteractiveText(text)
  if (!n) return false
  return patterns.some((p) => {
    const pat = normalizeInteractiveText(p)
    return n === pat || n.includes(pat)
  })
}

export function isNextQuestionCommand(text) {
  return matchesInteractivePatterns(text, INTERACTIVE_FLOW.commands.next_question)
}

export function isAffirmativeResponse(text) {
  return matchesInteractivePatterns(text, INTERACTIVE_FLOW.commands.affirmative)
}

export function isRepeatLastCommand(text) {
  return matchesInteractivePatterns(text, INTERACTIVE_FLOW.commands.repeat_last)
}

export function isSpeakSlowerCommand(text) {
  return matchesInteractivePatterns(text, INTERACTIVE_FLOW.commands.speak_slower)
}

export function isTakeMomentCommand(text) {
  return matchesInteractivePatterns(text, INTERACTIVE_FLOW.commands.take_moment)
}

function canAdvanceInteractiveStep(step, text) {
  const minChars = step.minResponseChars ?? 2
  const wantsNext = isNextQuestionCommand(text)
  const wantsYes = isAffirmativeResponse(text)
  const hasResponse = text.length >= minChars
  const mode = step.advanceMode || 'response_or_next'
  if (wantsNext) return { advance: true, softWait: false }
  if (mode === 'auto_after_speak') {
    if (text.length >= (step.minResponseChars ?? 1)) {
      return { advance: true, softWait: false }
    }
    return { advance: false, softWait: false }
  }
  if (mode === 'affirmative_or_next') {
    if (wantsYes) return { advance: true, softWait: false }
    if (hasResponse) return { advance: false, softWait: true }
    return { advance: false, softWait: false }
  }
  if (hasResponse) return { advance: true, softWait: false }
  return { advance: false, softWait: false }
}

function nextInteractiveStepSpoken(nextId, first, role) {
  if (nextId === 'questions') {
    return `Great — let's get started, ${first}. Here's your first question.`
  }
  const next = INTERACTIVE_FLOW.steps.find((s) => s.id === nextId)
  return next?.spokenTemplate ? fillInteractiveTemplate(next.spokenTemplate, first, role) : ''
}

function interviewTimeOfDayLabel() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date())
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 12)
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

function fillInteractiveTemplate(template, firstName, role) {
  return String(template || '')
    .replace(/\{firstName\}/g, firstName)
    .replace(/\{role\}/g, role)
    .replace(/\{timeOfDay\}/g, interviewTimeOfDayLabel())
}

/**
 * JSON action response for pre-interview small talk and "next question" / "yes" gates.
 * @param {{ phase: string, userText?: string, role?: string, profile?: ProfileContext, accountName?: string }} input
 */
export function processInterviewInteractive(input) {
  const phase = String(input.phase || 'day_check')
  const role = clean(input.role) || 'your role'
  const ctx = input.ctx || summarizeProfile(input.profile || {}, input.accountName || '')
  const first = firstNameFromFull(ctx.name)
  const text = clean(input.userText)

  if (phase === 'questions') {
    return {
      action: 'listen',
      nextPhase: 'questions',
      interactive: false,
    }
  }

  const step = INTERACTIVE_FLOW.steps.find((s) => s.id === phase)
  if (!step) {
    const welcome = INTERACTIVE_FLOW.steps.find((s) => s.id === 'day_check')
    return {
      action: 'listen',
      nextPhase: 'day_check',
      spoken: fillInteractiveTemplate(welcome?.spokenTemplate, first, role),
      interactive: false,
    }
  }

  if (isRepeatLastCommand(text)) {
    return {
      action: 'replay',
      nextPhase: phase,
      spoken: fillInteractiveTemplate(step.spokenTemplate, first, role),
      replay: true,
      interactive: true,
    }
  }

  if (isSpeakSlowerCommand(text)) {
    return {
      action: 'speak_slower',
      nextPhase: phase,
      spoken: `Sure ${first}, I'll speak a little slower. ${fillInteractiveTemplate(step.spokenTemplate, first, role)}`,
      adjustSpeechRate: 0.82,
      replay: true,
      interactive: true,
    }
  }

  if (isTakeMomentCommand(text)) {
    return {
      action: 'wait',
      nextPhase: phase,
      spoken: `Of course, ${first}. Take your time. Say yes when you're ready.`,
      interactive: true,
    }
  }

  const { advance, softWait } = canAdvanceInteractiveStep(step, text)

  if (advance && step.nextStep) {
    const startQuestions = step.onAdvanceAction === 'start_questions'
    return {
      action: startQuestions ? 'start_questions' : 'goto',
      nextPhase: startQuestions ? 'questions' : step.nextStep,
      spoken: nextInteractiveStepSpoken(step.nextStep, first, role),
      startQuestions,
      interactive: true,
    }
  }

  if (softWait && step.notReadyTemplate) {
    return {
      action: 'wait',
      nextPhase: phase,
      spoken: fillInteractiveTemplate(step.notReadyTemplate, first, role),
      interactive: true,
    }
  }

  return {
    action: 'listen',
    nextPhase: phase,
    spoken: fillInteractiveTemplate(step.spokenTemplate, first, role),
    interactive: false,
  }
}

export function getInterviewInteractiveFlowJson() {
  return INTERACTIVE_FLOW
}

export function llmConfigured() {
  return geminiApiConfigured()
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
  ],
  "awards": ["Honors or awards explicitly listed"],
  "metrics": [
    { "metric": "KPI", "contribution": "Action", "impact": "Outcome", "timePeriod": "Period" }
  ],
  "noticePeriod": "If stated",
  "preferredRoles": ["If stated"],
  "preferredLocations": ["If stated"],
  "workMode": "Remote/Hybrid/On-site if stated",
  "salaryExpectation": "If explicitly stated"
}

Resume Text:
${resumeText.slice(0, 12000)}`

  const llmResult = await callLlmApi({ system, user, temperature: 0.1, tier: 'quality' })
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
