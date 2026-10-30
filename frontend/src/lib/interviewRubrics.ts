/** Mirrors backend/node/interviewRubricScoring.mjs */
import type { Question } from './interviewEngine'

export const INTERVIEW_RUBRICS = [
  { id: 'correctness', label: 'Answer Correctness' },
  { id: 'depth', label: 'Depth' },
  { id: 'communication', label: 'Communication' },
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
  { correctness: number; depth: number; communication: number }
> = {
  opening_generic: { correctness: 0, depth: 0.2, communication: 0.8 },
  technical: { correctness: 0.5, depth: 0.3, communication: 0.2 },
  experience: { correctness: 0.32, depth: 0.33, communication: 0.35 },
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
) {
  const text = answer.trim()
  const lower = text.toLowerCase()
  const wordCount = text.split(/\s+/).filter(Boolean).length
  const profile = classifyQuestionScoringProfile(question)
  const weights = getRubricWeights(profile)

  const keywords = (question.keywords || []).map((k) => k.toLowerCase())
  const keywordsHit = keywords.filter((k) => lower.includes(k))
  const keywordCoverage =
    keywords.length > 0
      ? Math.round((keywordsHit.length / Math.min(keywords.length, 6)) * 100)
      : wordCount >= 20
        ? 65
        : 30

  const skillsHit = profileSkills.filter((s) => s.length >= 2 && lower.includes(s.toLowerCase()))
  let correctness = Math.min(100, Math.round(keywordCoverage * 0.5 + skillsHit.length * 15))
  if (wordCount < 10) correctness = Math.min(correctness, 25)

  const hasNumbers = /\d/.test(text)
  const hasTools = /\b(react|node|python|sql|aws|docker|typescript|java)\b/i.test(text)
  let depth = 25 + (wordCount >= 50 ? 20 : 0) + (hasNumbers ? 20 : 0) + (hasTools ? 15 : 0)
  depth = Math.min(100, depth)

  const structureHits = STRUCTURE_SIGNALS.filter((s) => lower.includes(s)).length
  const communication = Math.min(
    100,
    Math.round(wordCountBandScore(wordCount) * 0.6 + (structureHits / 3) * 100 * 0.4),
  )

  const scores = { correctness, depth, communication }
  const rubrics = INTERVIEW_RUBRICS.map((r) => ({
    id: r.id,
    label: r.label,
    weight: weights[r.id as keyof typeof weights],
    score: scores[r.id as keyof typeof scores],
  }))
  const score = Math.min(
    100,
    Math.round(rubrics.reduce((s, r) => s + r.score * r.weight, 0)),
  )
  return { rubrics, score, scoringProfile: profile }
}
