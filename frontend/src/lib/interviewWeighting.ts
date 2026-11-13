/**
 * Mirrors backend/app/services/interview_weighting.py: how the overall interview score is put together.
 *
 *   technical question   15 points of the 100
 *   every other question 10 points
 *   role skills fit      the remainder (25 for a fresher, 15 for an experienced candidate)
 *
 * The shares belong to the planned questions. A question nobody answered earns 0 but keeps its share, so stopping
 * after one question cannot produce a high score.
 */
import type { Question } from './interviewEngine'
import { classifyQuestionScoringProfile, INTERVIEW_RUBRICS } from './interviewRubrics'

export const TECHNICAL_WEIGHT = 15
export const OTHER_WEIGHT = 10
export const MIN_ROLE_FIT_WEIGHT = 10

type ScoredAnswer = { score: number; answer?: string; rubrics?: { id: string; score: number | null }[] }
type QuestionLike = Question & { focus?: string; scoringProfile?: string; topic?: string }

export type WeightedRow = {
  label: string
  type: 'technical' | 'other'
  weight: number
  score: number
  points: number
  answered: boolean
}

export type WeightedScore = {
  overall: number
  dimensions: { id: string; label: string; score: number }[]
  model: {
    technicalQuestionWeight: number
    otherQuestionWeight: number
    roleFitWeight: number
    plannedQuestions: number
    answeredQuestions: number
    questionPoints: number
    roleFitPoints: number
    roleFitScore: number
    rows: WeightedRow[]
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

/** Scored questions an interview is meant to have (the closing question is not scored). */
export function plannedSlots(fresher: boolean) {
  return { technical: 3, other: fresher ? 3 : 4 }
}

export function isClosingQuestion(q: QuestionLike): boolean {
  const focus = String(q.focus ?? '')
  return focus === 'structured-closing' || focus === 'pending-closing'
}

export function isTechnicalQuestion(q: QuestionLike): boolean {
  return classifyQuestionScoringProfile(q) === 'technical'
}

export function computeWeightedScore(options: {
  questions: QuestionLike[]
  analyses: ScoredAnswer[]
  fresher: boolean
  roleFitScore: number
}): WeightedScore {
  const answered = options.questions
    .map((question, index) => ({ question, index, analysis: options.analyses[index] }))
    .filter((x) => x.analysis && !isClosingQuestion(x.question))
    .map((x) => ({ ...x, technical: isTechnicalQuestion(x.question) }))

  const plan = plannedSlots(options.fresher)
  const nTech = Math.max(plan.technical, answered.filter((x) => x.technical).length)
  const nOther = Math.max(plan.other, answered.filter((x) => !x.technical).length)
  let wTech = TECHNICAL_WEIGHT
  let wOther = OTHER_WEIGHT
  let questionTotal = wTech * nTech + wOther * nOther
  const cap = 100 - MIN_ROLE_FIT_WEIGHT
  if (questionTotal > cap) {
    const scale = cap / questionTotal
    wTech *= scale
    wOther *= scale
    questionTotal = cap
  }
  const roleWeight = 100 - questionTotal
  const roleFit = clamp(options.roleFitScore)

  const rows: WeightedRow[] = []
  let earned = 0
  for (const x of answered) {
    const weight = x.technical ? wTech : wOther
    const score = Math.round(x.analysis.score || 0)
    const points = (weight * score) / 100
    earned += points
    rows.push({
      label: String(x.question.topic || x.question.category || `Question ${x.index + 1}`).slice(0, 60),
      type: x.technical ? 'technical' : 'other',
      weight: round1(weight),
      score,
      points: round1(points),
      answered: true,
    })
  }
  const missing = (kind: 'technical' | 'other', count: number, weight: number) => {
    for (let i = 0; i < Math.max(0, count); i += 1) {
      rows.push({ label: 'Not asked / not answered', type: kind, weight: round1(weight), score: 0, points: 0, answered: false })
    }
  }
  missing('technical', nTech - answered.filter((x) => x.technical).length, wTech)
  missing('other', nOther - answered.filter((x) => !x.technical).length, wOther)

  const roleFitPoints = (roleWeight * roleFit) / 100
  const overall = clamp(earned + roleFitPoints)

  const dimensions: WeightedScore['dimensions'] = []
  for (const def of INTERVIEW_RUBRICS) {
    if (def.id === 'roleSkillsFit') {
      dimensions.push({ id: def.id, label: def.label, score: roleFit })
      continue
    }
    let numerator = 0
    let denominator = questionTotal
    let seen = false
    for (const x of answered) {
      const weight = x.technical ? wTech : wOther
      const value = x.analysis.rubrics?.find((r) => r.id === def.id)?.score
      if (value == null || Number.isNaN(Number(value))) {
        denominator -= weight // this dimension was not evaluated for that question
        continue
      }
      seen = true
      numerator += weight * Number(value)
    }
    if (seen && denominator > 0) dimensions.push({ id: def.id, label: def.label, score: clamp(numerator / denominator) })
  }

  return {
    overall,
    dimensions,
    model: {
      technicalQuestionWeight: round1(wTech),
      otherQuestionWeight: round1(wOther),
      roleFitWeight: round1(roleWeight),
      plannedQuestions: nTech + nOther,
      answeredQuestions: answered.filter((x) => String(x.analysis.answer ?? '').trim()).length,
      questionPoints: round1(earned),
      roleFitPoints: round1(roleFitPoints),
      roleFitScore: roleFit,
      rows,
    },
  }
}

/** Fresher = no real job on the profile (internships do not count); mirrors the parser's rule. */
export function isFresherProfile(
  profile: { totalExperience?: string; workExperiences?: { company?: string; jobTitle?: string; employmentType?: string }[] } | null | undefined,
): boolean {
  const label = (profile?.totalExperience || '').toLowerCase()
  if (label.includes('fresher')) return true
  const realJobs = (profile?.workExperiences ?? []).filter(
    (w) => (w.company?.trim() || w.jobTitle?.trim()) && !/\bintern(?:ship)?s?\b|\bapprentice/i.test(`${w.jobTitle ?? ''} ${w.employmentType ?? ''}`),
  )
  if (realJobs.length) return false
  return !label || /\b0\s*[-–]\s*1\b|\b0\s*years?\b/.test(label)
}
