/** Mirrors backend/node/interviewRubricScoring.mjs */
import type { Question } from './interviewEngine'
import { computeQuestionRoleSkillsFit } from './roleSkillsFitScoring'

export const INTERVIEW_RUBRICS = [
  { id: 'correctness', label: 'Answer Correctness' },
  { id: 'depth', label: 'Depth' },
  { id: 'communication', label: 'Communication' },
  { id: 'roleSkillsFit', label: 'Role Skills Fit' },
] as const

export type ScoringProfile =
  | 'opening_generic'
  | 'technical'
  | 'experience'
  | 'project'
  | 'behavioral'
  | 'balanced'

export const RUBRIC_WEIGHT_BY_PROFILE: Record<
  ScoringProfile,
  { correctness: number; depth: number; communication: number; roleSkillsFit: number }
> = {
  opening_generic: { correctness: 0, depth: 0.15, communication: 0.55, roleSkillsFit: 0.3 },
  technical: { correctness: 0.45, depth: 0.25, communication: 0.15, roleSkillsFit: 0.15 },
  experience: { correctness: 0.28, depth: 0.27, communication: 0.25, roleSkillsFit: 0.2 },
  project: { correctness: 0.35, depth: 0.25, communication: 0.25, roleSkillsFit: 0.15 },
  behavioral: { correctness: 0.15, depth: 0.15, communication: 0.5, roleSkillsFit: 0.2 },
  balanced: { correctness: 0.3, depth: 0.25, communication: 0.25, roleSkillsFit: 0.2 },
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
]

function wordCountBandScore(wordCount: number) {
  if (wordCount < 8) return 15
  if (wordCount < 25) return 45
  if (wordCount < 45) return 72
  if (wordCount <= 180) return 100
  if (wordCount <= 260) return 78
  return 55
}

export function classifyQuestionScoringProfile(question: Question & { scoringProfile?: string }): ScoringProfile {
  const explicit = (question.scoringProfile || '').trim().toLowerCase()
  if (explicit && explicit in RUBRIC_WEIGHT_BY_PROFILE) return explicit as ScoringProfile

  const focus = (question.focus || '').toLowerCase()
  const cat = question.category || ''
  const text = question.text.toLowerCase()
  const topic = (question.topic || '').toLowerCase()

  if (focus.includes('structured-opening') || focus.includes('structured-fresher-intro')) return 'opening_generic'
  if (focus.includes('structured-theory') || focus.includes('structured-skill') || cat === 'Technical')
    return 'technical'
  if (focus.includes('structured-fallback-recent')) return 'project'
  if (
    focus.includes('structured-recent-project') ||
    focus.includes('structured-project') ||
    focus.includes('structured-cert') ||
    /project|certification/.test(topic)
  ) {
    return 'project'
  }
  if (focus.includes('structured-work') || cat === 'Experience') return 'experience'
  if (focus.includes('structured-closing') || cat === 'Communication') return 'behavioral'
  if (/\bproject\b|\bcertification\b/.test(text)) return 'project'
  if (/\btechnical\b|\bskill\b|\barchitect|\bapi\b/.test(text)) return 'technical'
  return 'balanced'
}

export function getRubricWeights(profile: ScoringProfile) {
  return { ...RUBRIC_WEIGHT_BY_PROFILE[profile] }
}

export const NON_TECH_RUBRIC_WEIGHTS = {
  opening: { correctness: 0.2, depth: 0.2, communication: 0.6, roleSkillsFit: 0 },
  situational: { correctness: 0.4, depth: 0.4, communication: 0.2, roleSkillsFit: 0 },
  stakeholder: { correctness: 0.35, depth: 0.4, communication: 0.25, roleSkillsFit: 0 },
  achievement: { correctness: 0.25, depth: 0.55, communication: 0.2, roleSkillsFit: 0 },
  followup: { correctness: 0.35, depth: 0.4, communication: 0.25, roleSkillsFit: 0 },
  communication: { correctness: 0.15, depth: 0.15, communication: 0.7, roleSkillsFit: 0 },
} as const

export const NON_TECH_DIMENSION_LABELS: Record<string, string> = {
  correctness: 'Situation fit',
  depth: 'Ownership & result',
  communication: 'Communication',
  roleSkillsFit: 'Role Skills Fit',
}

const OWNERSHIP_SOURCE =
  '\\b(decided|told|asked|called|emailed|wrote|sent|met|escalated|negotiated|refused|declined|approved|prioritized|owned|scheduled|followed|took|hired|presented|recommended|convinced|closed|resolved|renewed|retained|handled|collected|onboarded)\\b'
const STAKEHOLDER_RE =
  /\b(client|customer|stakeholder|manager|director|executive|legal|finance|recruiter|candidate|vendor|partner|teammate|team|user|boss|buyer|hiring)\b/i
const OUTCOME_WORD_RE =
  /\b(saved|reduced|increased|signed|hired|launched|approved|declined|missed|delayed|delivered|result|outcome|quota)\b/i
const VAGUE_PHRASES = [
  'somehow',
  'stuff',
  'things',
  'a lot',
  'various',
  'basically',
  'kind of',
  'sort of',
  'team player',
  'hard worker',
  'passionate',
  'synergy',
  'leverage',
  'circle back',
]

function clampScore(n: number) {
  return Math.max(0, Math.min(100, Math.round(n)))
}

function nonTechnicalProfile(question: Question & { scoringProfile?: string; focus?: string }) {
  const explicit = (question.scoringProfile || '').trim().toLowerCase()
  if (explicit in NON_TECH_RUBRIC_WEIGHTS) return explicit as keyof typeof NON_TECH_RUBRIC_WEIGHTS
  const focus = (question.focus || '').toLowerCase()
  if (focus.includes('opening')) return 'opening'
  if (focus.includes('closing')) return 'communication'
  return 'situational'
}

function lookForRatio(
  lookFor: string[] | undefined,
  lower: string,
  wordCount: number,
  ownership: boolean,
  stakeholder: boolean,
  outcome: boolean,
) {
  if (!lookFor?.length) return 0
  let hits = 0
  for (const item of lookFor) {
    const key = item.toLowerCase()
    if (key === 'own_action' && ownership) hits += 1
    else if (key === 'stakeholder' && stakeholder) hits += 1
    else if (key === 'situation' && wordCount >= 25) hits += 1
    else if (key === 'result' && outcome) hits += 1
    else if (key.startsWith('tool:') || key.startsWith('employer:')) {
      const name = item.split(':').slice(1).join(':').trim().toLowerCase()
      if (name && lower.includes(name)) hits += 1
    }
  }
  return hits / lookFor.length
}

/** Judgment heuristic. Naming React, Python, or any other engineering tool adds nothing. */
function scoreNonTechnicalAnswer(question: Question & { scoringProfile?: string; focus?: string; lookFor?: string[] }, answer: string) {
  const text = answer.trim()
  const lower = text.toLowerCase()
  const wordCount = text.split(/\s+/).filter(Boolean).length
  const ownership = new Set((lower.match(new RegExp(OWNERSHIP_SOURCE, 'gi')) || []).map((w) => w.toLowerCase()))
  const stakeholder = STAKEHOLDER_RE.test(lower)
  const hasNumber = /\d/.test(text)
  const hasOutcomeWord = OUTCOME_WORD_RE.test(lower)
  const outcome = hasNumber || /%|\$/.test(text) || hasOutcomeWord
  const vague = VAGUE_PHRASES.filter((p) => lower.includes(p)).length
  const hypothetical = ownership.size === 0 && /\bi would\b|\bi will\b|\bi could\b/.test(lower)
  const structureHits = STRUCTURE_SIGNALS.filter((s) => lower.includes(s)).length
  const fillerPenalty = /\b(um+|uh+|like,|you know)\b/i.test(text) ? 10 : 0
  let communication = clampScore(wordCountBandScore(wordCount) * 0.55 + Math.min(100, (structureHits / 3) * 100) * 0.45 - fillerPenalty)
  if (wordCount < 8) communication = Math.min(communication, 20)
  const ratio = lookForRatio(question.lookFor, lower, wordCount, ownership.size > 0, stakeholder, outcome)

  let correctness = 20
  if (wordCount >= 25) correctness += 25
  if (wordCount >= 60) correctness += 15
  correctness += Math.round(ratio * 40)
  if (stakeholder) correctness += 10
  if (wordCount < 10) correctness = Math.min(correctness, 25)
  if (wordCount < 5) correctness = Math.min(correctness, 10)
  if (vague >= 3 && ownership.size === 0) correctness = Math.min(correctness, 40)
  if (hypothetical) correctness = Math.min(correctness, 55)
  correctness = clampScore(correctness)

  let depth = 18
  if (ownership.size >= 1) depth += 16
  if (ownership.size >= 2) depth += 8
  if (wordCount >= 20 && ownership.size === 0) depth -= 12
  if (hasNumber) depth += 14
  if (hasOutcomeWord) depth += 16
  if (structureHits >= 2) depth += 12
  if (wordCount >= 40 && ownership.size === 0 && !hasNumber && !hasOutcomeWord) depth = Math.min(depth, 35)
  if (hypothetical) depth = Math.min(depth, 55)
  depth = clampScore(depth)

  const profile = nonTechnicalProfile(question)
  const weights = NON_TECH_RUBRIC_WEIGHTS[profile]
  const scores = { correctness, depth, communication, roleSkillsFit: null as number | null }
  const rubrics = INTERVIEW_RUBRICS.map((r) => ({
    id: r.id,
    label: NON_TECH_DIMENSION_LABELS[r.id] || r.label,
    weight: weights[r.id as keyof typeof weights],
    score: scores[r.id],
  }))
  const active = rubrics.filter((r) => r.weight > 0 && r.score != null) as { weight: number; score: number }[]
  const weightSum = active.reduce((s, r) => s + r.weight, 0)
  const score = weightSum > 0 ? clampScore(active.reduce((s, r) => s + r.score * (r.weight / weightSum), 0)) : 0
  return { rubrics, score, scoringProfile: profile }
}

/** Offline heuristic parity when API scoring is unavailable. */
export function scoreAnswerRubrics(
  question: Question & { scoringProfile?: string },
  answer: string,
  profileSkills: string[] = [],
  options: {
    ctx?: { skills?: string[]; resumeSnippet?: string }
    requiredRoleSkills?: string[]
  } = {},
) {
  if (question.questionModel === 'non_technical') return scoreNonTechnicalAnswer(question, answer)
  const text = answer.trim()
  const lower = text.toLowerCase()
  const wordCount = text.split(/\s+/).filter(Boolean).length
  const profile = classifyQuestionScoringProfile(question)
  const weights = getRubricWeights(profile)


  // Correctness is AI-only in production scoring; local fallback omits it.
  const correctness: number | null = null

  const hasNumbers = /\d/.test(text)
  const hasTools = /\b(react|node|python|sql|aws|docker|typescript|java)\b/i.test(text)
  let depth = 25 + (wordCount >= 50 ? 20 : 0) + (hasNumbers ? 20 : 0) + (hasTools ? 15 : 0)
  depth = Math.min(100, depth)

  const structureHits = STRUCTURE_SIGNALS.filter((s) => lower.includes(s)).length
  const communication = Math.min(
    100,
    Math.round(wordCountBandScore(wordCount) * 0.6 + (structureHits / 3) * 100 * 0.4),
  )

  const roleSkillsFit = computeQuestionRoleSkillsFit(
    question,
    answer,
    {
      skills: options.ctx?.skills ?? profileSkills,
      resumeSnippet: options.ctx?.resumeSnippet,
    },
    options.requiredRoleSkills ?? [],
  )

  const scores: Record<(typeof INTERVIEW_RUBRICS)[number]['id'], number | null> = {
    correctness,
    depth,
    communication,
    roleSkillsFit,
  }
  const rubrics = INTERVIEW_RUBRICS.map((r) => ({
    id: r.id,
    label: r.label,
    weight: weights[r.id as keyof typeof weights],
    score: scores[r.id],
  }))
  const active = rubrics.filter((r) => r.weight > 0 && r.score != null) as {
    weight: number
    score: number
  }[]
  const weightSum = active.reduce((s, r) => s + r.weight, 0)
  const score =
    weightSum > 0
      ? Math.min(
          100,
          Math.round(active.reduce((s, r) => s + r.score * (r.weight / weightSum), 0)),
        )
      : 0
  return { rubrics, score, scoringProfile: profile }
}
