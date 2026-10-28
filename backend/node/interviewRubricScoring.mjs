/**
 * Interview evaluation rubrics: Correctness (AI-primary), Depth, Communication.
 * Weights vary by question type (technical vs project/experience vs behavioral).
 */

function clean(s) {
  return String(s ?? '').trim()
}

function unique(arr) {
  return [...new Set(arr.filter(Boolean))]
}

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(Number(n) || 0)))
}

export const INTERVIEW_RUBRICS = [
  { id: 'correctness', label: 'Answer Correctness' },
  { id: 'depth', label: 'Depth' },
  { id: 'communication', label: 'Communication' },
]

/** @typedef {'opening_generic' | 'technical' | 'experience' | 'project' | 'behavioral' | 'balanced'} ScoringProfile */

/** Weights must sum to 1. */
export const RUBRIC_WEIGHT_BY_PROFILE = {
  /** Q1 — roles, responsibilities, exposure at previous employer. */
  opening_generic: { correctness: 0, depth: 0.2, communication: 0.8 },
  /** Three role-skill questions after opening analysis. */
  technical: { correctness: 0.5, depth: 0.3, communication: 0.2 },
  experience: { correctness: 0.32, depth: 0.33, communication: 0.35 },
  /** Project + fallback-recent questions. */
  project: { correctness: 0.4, depth: 0.3, communication: 0.3 },
  behavioral: { correctness: 0.18, depth: 0.22, communication: 0.6 },
  balanced: { correctness: 0.34, depth: 0.33, communication: 0.33 },
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

function wordCountBandScore(wordCount) {
  if (wordCount < 8) return 15
  if (wordCount < 25) return 45
  if (wordCount < 45) return 72
  if (wordCount <= 180) return 100
  if (wordCount <= 260) return 78
  return 55
}

/**
 * @param {{ text?: string, category?: string, focus?: string, topic?: string, resumeAnchor?: string }} question
 * @returns {ScoringProfile}
 */
export function classifyQuestionScoringProfile(question) {
  const explicit = clean(question.scoringProfile).toLowerCase()
  if (explicit && RUBRIC_WEIGHT_BY_PROFILE[explicit]) return explicit

  const focus = clean(question.focus).toLowerCase()
  const cat = clean(question.category)
  const text = clean(question.text).toLowerCase()
  const topic = clean(question.topic).toLowerCase()

  if (focus.includes('structured-opening')) return 'opening_generic'
  if (focus.includes('structured-theory') || focus.includes('structured-skill') || focus.includes('jd-first'))
    return 'technical'
  if (cat === 'Technical' && !focus.includes('structured-opening')) return 'technical'
  if (focus.includes('structured-fallback-recent')) return 'project'
  if (
    focus.includes('structured-recent-project') ||
    focus.includes('structured-project') ||
    focus.includes('structured-cert') ||
    /project|certification|credential/.test(topic)
  ) {
    return 'project'
  }
  if (focus.includes('structured-work') || (cat === 'Experience' && !focus.includes('structured-opening')))
    return 'experience'
  if (focus.includes('structured-closing') || cat === 'Communication') return 'behavioral'
  if (/\bproject\b|\bbuilt\b|\bshipped\b|\bcertification\b/.test(text)) return 'project'
  if (/\btechnical\b|\bskill\b|\barchitect|\bapi\b|\bdatabase\b|\bstack\b/.test(text)) return 'technical'
  if (/\bwhy\b|\bfitc\b|\bstrength\b|\bmotivat/.test(text)) return 'behavioral'
  return 'balanced'
}

/** @param {ScoringProfile} profile */
export function getRubricWeights(profile) {
  return { ...(RUBRIC_WEIGHT_BY_PROFILE[profile] || RUBRIC_WEIGHT_BY_PROFILE.balanced) }
}

/**
 * Heuristic fallback when LLM is unavailable.
 * @param {object} question
 * @param {string} answer
 * @param {ReturnType<import('./interviewAgent.mjs').summarizeProfile>} ctx
 */
export function computeHeuristicRubricScores(question, answer, ctx) {
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
        ? 65
        : 30

  const skillsHit = (ctx.skills || []).filter((s) => s.length >= 2 && lower.includes(s.toLowerCase()))
  const companyTokens = (ctx.jobs || [])
    .flatMap((j) => j.split(/[@:]/).map((p) => p.trim().toLowerCase()))
    .filter((t) => t.length >= 3 && !['role', 'company', 'at'].includes(t))
  const companiesHit = companyTokens.filter((t) => lower.includes(t))
  const anchor = clean(question.resumeAnchor).toLowerCase()
  const anchorHit = anchor.length >= 3 && lower.includes(anchor)

  let correctness = Math.min(
    100,
    Math.round(keywordCoverage * 0.45 + skillsHit.length * 12 + companiesHit.length * 10 + (anchorHit ? 15 : 0)),
  )
  if (wordCount < 10) correctness = Math.min(correctness, 25)
  if (wordCount < 5) correctness = 10

  const hasNumbers = /\d/.test(text)
  const hasMetrics = /\b(\d+\s*%|\$\d|percent|increase|reduce|saved|improved|latency|throughput|users)\b/i.test(text)
  const hasTools =
    /\b(react|node|python|sql|aws|docker|typescript|java|kafka|postgres|kubernetes|api|microservice)\b/i.test(
      text,
    )
  const outcomeWords = (text.match(/\b(built|shipped|led|fixed|designed|implemented|delivered|migrated|owned)\b/gi) || [])
    .length
  let depth = 22
  if (wordCount >= 35) depth += 18
  if (wordCount >= 60) depth += 12
  if (hasNumbers) depth += 14
  if (hasMetrics) depth += 16
  if (hasTools) depth += 12
  depth += Math.min(18, outcomeWords * 4)
  depth += Math.min(12, skillsHit.length * 4)
  depth = clamp(depth)

  const structureHits = STRUCTURE_SIGNALS.filter((s) => lower.includes(s)).length
  const clarityBand = wordCountBandScore(wordCount)
  const fillerPenalty = /\b(um+|uh+|like,|you know)\b/i.test(text) ? 10 : 0
  let communication = Math.max(
    0,
    Math.min(100, Math.round(clarityBand * 0.55 + Math.min(100, (structureHits / 3) * 100) * 0.45 - fillerPenalty)),
  )
  if (wordCount < 8) communication = Math.min(communication, 20)

  return {
    correctness,
    depth,
    communication,
    wordCount,
    keywordsHit: unique([...keywordsHit, ...skillsHit.map(String)]),
    skillsHit,
    scoringProfile: classifyQuestionScoringProfile(question),
  }
}

/**
 * @param {{ correctness?: number, depth?: number, communication?: number }} heuristic
 * @param {{ correctness?: number, depth?: number, communication?: number, feedback?: string } | null | undefined} llm
 */
export function mergeRubricScores(heuristic, llm) {
  if (!llm) return { ...heuristic, source: 'heuristic' }
  const blend = (h, l, llmWeight) => clamp(h * (1 - llmWeight) + l * llmWeight)
  return {
    correctness: clamp(
      typeof llm.correctness === 'number' ? llm.correctness : heuristic.correctness,
    ),
    depth: clamp(typeof llm.depth === 'number' ? blend(heuristic.depth, llm.depth, 0.4) : heuristic.depth),
    communication: clamp(
      typeof llm.communication === 'number'
        ? blend(heuristic.communication, llm.communication, 0.4)
        : heuristic.communication,
    ),
    feedback: clean(llm.feedback) || undefined,
    source: 'llm+heuristic',
  }
}

/** @param {ScoringProfile} profile */
export function buildWeightedRubrics(scores, profile) {
  const weights = getRubricWeights(profile)
  return INTERVIEW_RUBRICS.map((def) => ({
    id: def.id,
    label: def.label,
    weight: weights[def.id] ?? 0.33,
    score: clamp(scores[def.id] ?? 0),
  }))
}

export function weightedQuestionScore(rubrics) {
  const sum = rubrics.reduce((acc, r) => acc + r.score * r.weight, 0)
  return clamp(sum)
}
