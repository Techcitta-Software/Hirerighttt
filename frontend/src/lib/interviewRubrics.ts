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
