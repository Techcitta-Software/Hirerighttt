import { selectFresherConcept } from './fresherConcepts'
/**
 * Adaptive interview question generation — mirrors `question-generation.md` and
 * `backend/node/interviewAgent.mjs` (`generateAdaptiveQuestion`, `summarizeProfile`).
 */
import type { Question } from './interviewEngine'
import type { SavedProfile } from './store'
import { candidateFullName } from './store'
import { clientLlmAllowed } from './clientLlm'
import {
  buildStructuredTurnQuestion,
  resolveExactInterviewRole,
  structuredPlanSummary,
  extractResumeProjects,
  selectProjectForInterview,
  questionMatchesPlan,
  isTheoryTurnForPlan,
  FRESHER_INTERVIEW_TURN_COUNT,
  isPlanFresher,
  analyzeOpeningAnswerAlignment,
} from './interviewQuestionPlan'
import { getSkillsForRole } from './roleSkillStore'

/** Default turn count for freshers; experienced interviews use role skill count + 2. */
export const INTERVIEW_TURN_COUNT = FRESHER_INTERVIEW_TURN_COUNT

export function resolveInterviewTotalTurns(
  profile: SavedProfile | null,
  level: string,
  ctx: ProfileDigest,
  roleOverride = '',
): number {
  const exactRole = resolveExactInterviewRole(profile, roleOverride)
  const roleSkills = isPlanFresher(profile, ctx, level) ? null : getSkillsForRole(exactRole)
  return structuredPlanSummary(exactRole, ctx, profile, level, roleSkills).totalTurns
}

const CATEGORIES = ['Communication', 'Technical', 'Problem Solving', 'Experience'] as const
const DEMO_ACCOUNT_NAME = 'Arjun Sharma'

function clean(s: unknown): string {
  return String(s ?? '').trim()
}

function unique(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))]
}

function isDemoPlaceholderName(name: string): boolean {
  const t = clean(name)
  if (!t) return false
  return t === DEMO_ACCOUNT_NAME || /^arjun\s+sharma$/i.test(t)
}

export function resolveCandidateName(profile: SavedProfile | null, accountName = ''): string {
  if (!profile) return clean(accountName) || 'Candidate'
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
      return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ')
    }
  }

  const acct = clean(accountName) || candidateFullName()
  if (acct && acct !== 'Candidate' && !isDemoPlaceholderName(acct)) return acct
  return 'Candidate'
}

export function firstNameFromFull(full: string): string {
  const n = clean(full)
  if (!n || n === 'Candidate' || isDemoPlaceholderName(n)) return 'there'
  return n.split(/\s+/)[0] || 'there'
}

export type ProfileDigest = {
  name: string
  skills: string[]
  jobs: string[]
  achievements: string[]
  certs: string[]
  resumeSnippet: string
  role?: string
}

export function summarizeProfileForQuestions(
  profile: SavedProfile | null,
  accountName = '',
): ProfileDigest {
  const resolvedName = resolveCandidateName(profile, accountName)
  const skills = unique((profile?.skills || []).map((s) => clean(s))).slice(0, 16)
  const jobs = (profile?.workExperiences || [])
    .filter((w) => w?.jobTitle || w?.company)
    .slice(0, 4)
    .map(
      (w) =>
        `${clean(w.jobTitle) || 'Role'} @ ${clean(w.company) || 'Company'}${
          w.responsibilities ? `: ${clean(w.responsibilities).slice(0, 180)}` : ''
        }`,
    )
  const achievements = (profile?.achievements || []).map(clean).filter(Boolean).slice(0, 5)
  const certs = (profile?.certifications || []).map((c) => clean(c?.name)).filter(Boolean).slice(0, 5)
  const resumeSnippet = clean(profile?.resumeText).slice(0, 3500)

  return {
    name: resolvedName,
    skills,
    jobs,
    achievements,
    certs,
    resumeSnippet,
    role: clean(profile?.currentRole),
  }
}

export function buildAdaptiveQuestionSystemPrompt(options: {
  turnNumber: number
  role: string
  exactRole?: string
  level: string
  first: string
  planSummary?: ReturnType<typeof structuredPlanSummary>
  totalTurns?: number
  varietySeed?: string
}): string {
  const nameRule =
    options.first === 'there'
      ? 'Do NOT use fake names (no Arjun, no Candidate). Start neutrally or with "you".'
      : `You may use the first name "${options.first}" once if natural.`
  const totalTurns = options.totalTurns || options.planSummary?.totalTurns || INTERVIEW_TURN_COUNT
  const planRule = options.planSummary
    ? `- STRUCTURED INTERVIEW PLAN (mandatory): Exact role "${options.exactRole || options.role}". Recommended skills: ${(options.planSummary.recommendedSkills || []).join(', ') || 'see payload'}. Turn ${options.turnNumber}: ${options.planSummary.turnPlan[options.turnNumber - 1] || 'follow slot'}. Follow each slot exactly. One theory question per assigned skill; recent-work slots use the most recent employment. Calibrate concept depth to years of experience. Do not require production work from freshers.`
    : ''
  const varietyRule = options.varietySeed
    ? `- Use varietySeed "${options.varietySeed}" to pick a fresh angle within the slot. Candidates with the same role and experience must not receive identical wording across sessions.`
    : ''
  return `You are Ava, a realistic professional interviewer on a live video call. Generate exactly ONE new interview question (JSON only).
For fresher theory turns, use selectedConcept as the concept to assess. Write a fresh beginner-level question about it. Cover varied concepts across sessions, including OOP, functions, collections, control flow, error handling, testing and database fundamentals where supported by the assigned language or skill. Never repeat a concept already assessed in priorQuestions, even with different wording; choose another relevant concept if necessary.

Rules:
- This is question ${options.turnNumber} of ${totalTurns}. Never repeat or lightly rephrase any prior question.
- Use the candidate resume, role "${options.exactRole || options.role}", experience "${options.level}", job description (if any), and their last answer to choose the next realistic topic.
- One clear idea per question — how a real hiring manager speaks.
- Use short sentences and simple words at every experience level. Under 2 years: basics and small implementation steps; 2 to under 5 years: debugging, testing and practical choices; 5+ years: design choices, reliability and consequences. Use the numeric experienceYears and difficulty in the payload; a senior job title alone must not increase difficulty.
- In project slots, use the supplied projectContext and lastAnswer to ask ONE technical question about how the candidate built, tested or fixed a specific part. Use selectedProject for the first project question; follow the project actually discussed in lastAnswer for the second question. Only mention tools or results present in that project or the answer. If evidence is missing, ask the candidate to choose a real project. Do not invent scale, architecture, employers or outcomes.
- For freshers, use short sentences and simple words. Ask about the assigned role skill without assuming prior work with it; SQL is not mandatory in every fresher session. Keep concepts at beginner level and assess a different concept from earlier questions.
- In a theory slot, ask about a specific concept within the assigned skill; no personal work stories, résumé references, coding exercise or invented projects. Leave resumeAnchor empty and set topic to the assigned skill.
- Work/project/certification slots may use supplied history. If evidence is missing, ask neutrally rather than assuming a company or credential.
- ${nameRule}
- Do not invent employers, degrees, or projects absent from the resume snippet.
- category must be one of: Communication, Technical, Problem Solving, Experience.
${planRule}
${varietyRule}

Return ONLY: {"question":{"text":"...","category":"...","keywords":["..."],"hint":"...","topic":"...","resumeAnchor":"optional"}}`
}

export function buildAdaptiveQuestionUserPayload(options: {
  turnNumber: number
  role: string
  exactRole?: string
  recommendedSkills?: string[]
  planSummary?: ReturnType<typeof structuredPlanSummary>
  level: string
  jobDescription?: string
  ctx: ProfileDigest
  priorTexts: string[]
  profile?: SavedProfile | null
  lastAnswer: string
  totalTurns?: number
  varietySeed?: string
}): string {
  const theory = options.planSummary && isTheoryTurnForPlan(options.planSummary, options.turnNumber)
  const totalTurns = options.totalTurns || options.planSummary?.totalTurns || INTERVIEW_TURN_COUNT
  return JSON.stringify({
    turnNumber: options.turnNumber,
    totalTurns,
    questionVarietySeed: options.varietySeed || null,
    selectedConcept: theory && options.planSummary?.fresher ? selectFresherConcept(options.planSummary.recommendedSkills[options.turnNumber - 1], options.varietySeed, options.turnNumber, options.priorTexts) : undefined,
    roleTrack: options.exactRole || options.role,
    exactRole: options.exactRole || options.role,
    recommendedSkillsForRole: options.planSummary?.recommendedSkills || options.recommendedSkills || [],
    interviewPlan: options.planSummary?.turnPlan || [],
    experienceLevel: options.level,
    experienceYears: options.planSummary?.experienceYears,
    difficulty: options.planSummary?.difficulty,
    topRoleSkills: options.planSummary?.topRoleSkills,
    jobDescription: options.jobDescription?.trim() || null,
    candidateSummary: theory ? undefined : {
      skills: options.ctx.skills.slice(0, 16),
      jobs: options.ctx.jobs.slice(0, 4),
      achievements: options.ctx.achievements.slice(0, 5),
      certifications: options.ctx.certs.slice(0, 5),
      resumeSnippet: options.ctx.resumeSnippet.slice(0, 2800),
    },
    selectedProject: theory ? undefined : selectProjectForInterview(options.profile || null, options.ctx, options.exactRole || options.role, options.varietySeed),
    projectContext: theory ? undefined : extractResumeProjects(options.profile || null, options.ctx, options.exactRole || options.role).slice(0, 5),
    priorQuestions: options.priorTexts,
    lastAnswer: theory ? null : options.lastAnswer.trim() || null,
  })
}

export function normalizeAdaptiveQuestion(
  raw: {
    text?: string
    category?: string
    keywords?: string[]
    hint?: string
    topic?: string
    resumeAnchor?: string
  },
  priorTexts: string[] = [],
): Question | null {
  const text = clean(raw.text)
  if (text.length < 24) return null
  if (priorTexts.some((p) => p === text || p.slice(0, 40) === text.slice(0, 40))) return null
  const category = CATEGORIES.includes(raw.category as (typeof CATEGORIES)[number])
    ? (raw.category as Question['category'])
    : 'Technical'
  return {
    text,
    category,
    keywords: unique((raw.keywords || []).map((k) => clean(k).toLowerCase())).slice(0, 12),
    hint: clean(raw.hint) || 'Give a concrete example with tools and outcome.',
    topic: clean(raw.topic) || clean(raw.category) || 'Interview',
    resumeAnchor: clean(raw.resumeAnchor) || undefined,
    focus: 'adaptive-llm',
  }
}

function spokenLead(first: string, clause: string): string {
  const body = clean(clause)
  if (!body) return ''
  if (!first || first === 'there') return body.charAt(0).toUpperCase() + body.slice(1)
  return `${first}, ${body}`
}

function isFresherExperienceLevel(level: string): boolean {
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

function isSeniorExperienceLevel(level: string): boolean {
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

function isThinAnswer(text: string): boolean {
  return clean(text).split(/\s+/).filter(Boolean).length < 12
}

const TECH_CLAIM_RE =
  /\b(java|python|javascript|typescript|react|node\.?js|angular|vue|spring|kotlin|go|golang|rust|c\+\+|c#|\.net|sql|postgresql|mongodb|mysql|redis|kafka|aws|azure|gcp|docker|kubernetes|graphql|microservices|flutter|swift|android)\b/gi
const STACK_CLAIM_RE =
  /\b(full[\s-]?stack(?:\s+development|\s+engineering)?|front[\s-]?end(?:\s+development)?|back[\s-]?end(?:\s+development)?|mern|mean|devops|ui\/ux|mobile\s+development)\b/gi
const SUBJECT_CLAIM_RE =
  /\b(math|mathematics|statistics|calculus|algebra|geometry|physics|chemistry|biology|nursing|finance|accounting|marketing|sales|leadership|communication|writing|design|cad|mechanical|electrical|civil|structural|pipelines?|safety|hse|healthcare)\b/gi

function titleCasePhrase(s: string): string {
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

export function extractClaimedSkills(text: string): string[] {
  const found: string[] = []
  const lower = clean(text).toLowerCase()
  let m: RegExpExecArray | null
  const stackRe = new RegExp(STACK_CLAIM_RE.source, 'gi')
  while ((m = stackRe.exec(lower))) found.push(m[1])
  const goodAt = lower.match(
    /(?:good at|great at|strong in|strong at|experienced in|expert in|skilled in|proficient in|specializ(?:e|ing) in)\s+([a-z0-9+#./\s-]{2,56})/i,
  )
  if (goodAt?.[1]) {
    goodAt[1]
      .split(/,|\band\b/)
      .map((s) => s.trim().replace(/\.$/, ''))
      .filter(Boolean)
      .forEach((s) => found.push(s))
  }
  const techRe = new RegExp(TECH_CLAIM_RE.source, 'gi')
  while ((m = techRe.exec(lower))) found.push(m[1])
  const subjRe = new RegExp(SUBJECT_CLAIM_RE.source, 'gi')
  while ((m = subjRe.exec(lower))) found.push(m[1])
  return unique(found.map(titleCasePhrase)).slice(0, 5)
}

function questionMentions(history: { question?: Question }[], label: string): boolean {
  const key = clean(label).toLowerCase()
  if (key.length < 2) return false
  return history.some((h) => {
    const text = clean(h.question?.text).toLowerCase()
    const topic = clean(h.question?.topic).toLowerCase()
    return topic === key || text.includes(key)
  })
}

function buildClaimedSkillQuestion(first: string, skill: string, role: string): string {
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

function buildFirstAdaptiveQuestionLocal(
  first: string,
  role: string,
  level: string,
  ctx: ProfileDigest,
): Question {
  if (isFresherExperienceLevel(level)) {
    return {
      text: ctx.resumeSnippet
        ? spokenLead(
            first,
            `you're interviewing for ${role} as a ${level} candidate. Walk me through yourself — education, projects or internships, and strengths from your resume that fit this role.`,
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
            `I've reviewed your resume for ${role} (${level}). Walk me through your professional experience — roles, industry context, and outcomes you're proud of.`,
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

function pickResumeTopic(ctx: ProfileDigest, history: { question?: Question }[]) {
  const asked = new Set(
    history.map((h) => clean(h.question?.topic || h.question?.text?.slice(0, 40)).toLowerCase()),
  )
  for (const jobLine of ctx.jobs || []) {
    const topic = clean(jobLine).slice(0, 80)
    if (topic && !asked.has(topic.toLowerCase())) return { topic, label: topic }
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

function buildResumeTopicQuestion(
  first: string,
  role: string,
  level: string,
  topic: { topic: string; label: string },
): Question {
  const label = topic.label
  const fresher = isFresherExperienceLevel(level)
  const senior = isSeniorExperienceLevel(level)
  let text: string
  let category: Question['category'] = 'Experience'
  if (fresher) {
    text = spokenLead(
      first,
      `on your background I see ${label}. Walk me through what you built or learned, the tools you used, and how you checked that it worked.`,
    )
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
    keywords: unique([label.toLowerCase().slice(0, 48), 'outcome', role.toLowerCase()]),
    hint: 'Use only details that are actually on your résumé.',
    topic: topic.topic || label,
    resumeAnchor: label,
    focus: 'adaptive-local',
  }
}

function nextResumeSkillInJobDescription(
  jobDescription: string,
  ctx: ProfileDigest,
  history: { question?: Question }[],
): string {
  const jd = clean(jobDescription).toLowerCase()
  if (!jd) return ''
  const snippet = clean(ctx.resumeSnippet).toLowerCase()
  for (const skill of ctx.skills || []) {
    const s = clean(skill)
    if (s.length < 2) continue
    const key = s.toLowerCase()
    if (!jd.includes(key)) continue
    if (!snippet.includes(key) && !ctx.skills.some((x) => clean(x).toLowerCase() === key)) continue
    if (questionMentions(history, s)) continue
    return s
  }
  return ''
}

function buildLevelFallbackQuestion(first: string, role: string, level: string, turnNumber: number): string {
  if (turnNumber >= INTERVIEW_TURN_COUNT) {
    return spokenLead(
      first,
      `why is this ${role} role a fit for you now, and what is one strength from your own experience we should remember?`,
    )
  }
  if (isFresherExperienceLevel(level)) {
    return spokenLead(
      first,
      `pick a project or class from your own background for ${role}. What did you build or learn, and how did you check that it worked?`,
    )
  }
  if (isSeniorExperienceLevel(level)) {
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

/** Offline parity with server `generateAdaptiveQuestionLocal` (no Gemini key required). */
export function generateAdaptiveQuestionLocal(options: {
  profile: SavedProfile | null
  accountName?: string
  role: string
  level: string
  jobDescription?: string
  history: { question: Question; answer: string }[]
  lastAnswer: string
  varietySeed?: string
  openingAnalysis?: ReturnType<typeof analyzeOpeningAnswerAlignment> | null
}): Question {
  const ctx = summarizeProfileForQuestions(options.profile, options.accountName)
  const role = options.role || 'Full Stack Engineer'
  const exactRole = resolveExactInterviewRole(options.profile, role)
  const level = options.level || '1–3 years'
  const roleSkills = isPlanFresher(options.profile, ctx, level) ? null : getSkillsForRole(exactRole)
  const openingAnalysis =
    options.openingAnalysis ||
    (!isPlanFresher(options.profile, ctx, level) && options.history[0]?.answer
      ? analyzeOpeningAnswerAlignment(options.history[0].answer, roleSkills || [], ctx)
      : null)
  const planSummary = structuredPlanSummary(exactRole, ctx, options.profile, level, roleSkills, openingAnalysis, options.varietySeed)
  const totalTurns = planSummary.totalTurns
  const history = options.history || []
  if (history.length >= totalTurns) {
    throw new Error('INTERVIEW_COMPLETE')
  }
  const lastAnswer = clean(options.lastAnswer)
  const priorTexts = history.map((h) => clean(h.question?.text)).filter(Boolean)
  const first = firstNameFromFull(ctx.name)
  const turnNumber = history.length + 1
  const candidates: Question[] = []

  const structured = buildStructuredTurnQuestion({
    turnNumber,
    first,
    level,
    profile: options.profile,
    ctx,
    roleOverride: exactRole,
    history,
    senior: isSeniorExperienceLevel(level),
    planSummary,
    roleSkills,
    varietySeed: options.varietySeed,
    openingAnalysis,
    lastAnswer: options.lastAnswer,
  })
  if (structured) {
    const planned = normalizeAdaptiveQuestion(structured, priorTexts)
    if (planned) return { ...planned, focus: structured.focus || 'structured-plan' }
  }

  if (history.length === 0) {
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
      const topic = pickResumeTopic(ctx, history)
      if (topic && !questionMentions(history, topic.label)) {
        candidates.push(buildResumeTopicQuestion(first, role, level, topic))
      }
    }
    const jdSkill = nextResumeSkillInJobDescription(options.jobDescription || '', ctx, history)
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

  candidates.push({
    text: buildLevelFallbackQuestion(first, role, level, turnNumber),
    category: turnNumber >= totalTurns ? 'Communication' : 'Problem Solving',
    keywords: unique(['experience', 'outcome', role.toLowerCase()]),
    hint: 'Give a concrete example with tools and outcome.',
    topic: turnNumber >= totalTurns ? 'Closing' : 'Interview',
    focus: 'adaptive-local',
  })
  candidates.push({
    text: spokenLead(
      first,
      `for question ${turnNumber} of ${totalTurns}, describe a result you personally produced for ${role} work — what you did and how you knew it worked.`,
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

async function callClientLlm(system: string, user: string, temperature: number): Promise<string | null> {
  if (!clientLlmAllowed()) return null
  const key =
    import.meta.env.VITE_GEMINI_API_KEY?.trim() ||
    import.meta.env.VITE_OPENAI_API_KEY?.trim() ||
    ''
  if (!key) return null

  const base = (
    typeof window !== 'undefined'
      ? '/ai-proxy'
      : import.meta.env.VITE_GEMINI_BASE_URL ||
        'https://generativelanguage.googleapis.com/v1beta/openai'
  ).replace(/\/$/, '')

  const model = import.meta.env.VITE_PRIMARY_MODEL || 'gemini-3.1-flash-lite'

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'x-goog-api-key': key,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature,
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content
    if (typeof content === 'string' && content.trim()) return content
  } catch {
    return null
  }
  return null
}

/** Client-side parity with server `generateAdaptiveQuestion`. Falls back to local rules with no API key. */
export async function generateAdaptiveQuestionClient(options: {
  profile: SavedProfile | null
  accountName?: string
  role: string
  level: string
  jobDescription?: string
  history: { question: Question; answer: string }[]
  lastAnswer: string
  varietySeed?: string
  openingAnalysis?: ReturnType<typeof analyzeOpeningAnswerAlignment> | null
}): Promise<Question> {
  const ctx = summarizeProfileForQuestions(options.profile, options.accountName)
  const exactRole = resolveExactInterviewRole(options.profile, options.role)
  const roleSkills = isPlanFresher(options.profile, ctx, options.level) ? null : getSkillsForRole(exactRole)
  const openingAnalysis =
    options.openingAnalysis ||
    (!isPlanFresher(options.profile, ctx, options.level) && options.history[0]?.answer
      ? analyzeOpeningAnswerAlignment(options.history[0].answer, roleSkills || [], ctx)
      : null)
  const varietySeed =
    options.varietySeed ||
    (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().slice(0, 16) : String(Date.now()))
  const planSummary = structuredPlanSummary(
    exactRole,
    ctx,
    options.profile,
    options.level,
    roleSkills,
    openingAnalysis,
    varietySeed,
  )
  const recommendedSkills = planSummary.recommendedSkills
  const totalTurns = planSummary.totalTurns
  if (options.history.length >= totalTurns) {
    throw new Error('INTERVIEW_COMPLETE')
  }
  const turnNumber = options.history.length + 1
  const priorTexts = options.history
    .map((h) => clean(h.question?.text))
    .filter(Boolean)
  const first = firstNameFromFull(ctx.name)

  const system = buildAdaptiveQuestionSystemPrompt({
    turnNumber,
    role: options.role,
    exactRole,
    level: clean(options.profile?.totalExperience) || options.level,
    first,
    planSummary,
    totalTurns,
    varietySeed,
  })
  const user = buildAdaptiveQuestionUserPayload({
    turnNumber,
    role: options.role,
    exactRole,
    recommendedSkills,
    planSummary,
    totalTurns,
    varietySeed,
    level: clean(options.profile?.totalExperience) || options.level,
    jobDescription: options.jobDescription,
    ctx,
    profile: options.profile,
    priorTexts,
    lastAnswer: options.lastAnswer,
  })

  for (const temperature of [0.62, 0.42]) {
    const text = await callClientLlm(system, user, temperature)
    if (!text) continue
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) continue
    try {
      const parsed = JSON.parse(match[0]) as { question?: Question } & Question
      const q = normalizeAdaptiveQuestion(parsed.question || parsed, priorTexts)
      if (q && questionMatchesPlan(q, planSummary, turnNumber)) return q
    } catch {
      // retry temperature
    }
  }
  return generateAdaptiveQuestionLocal({ ...options, varietySeed })
}
