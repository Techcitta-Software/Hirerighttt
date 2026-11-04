import type { AnswerAnalysis, InterviewResult } from './store'

type RubricRow = { id?: string; score: number | null }

function rubric100(rubrics: RubricRow[] | undefined, id: string): number | null {
  const hit = rubrics?.find((r) => r.id === id)
  if (hit?.score == null || Number.isNaN(Number(hit.score))) return null
  return Math.min(100, Math.round(Number(hit.score)))
}

function rubric10(rubrics: RubricRow[] | undefined, id: string, fallback: number): number {
  const pct = rubric100(rubrics, id)
  if (pct == null) return id === 'correctness' ? 0 : Math.min(10, Math.round(fallback / 10))
  return Math.min(10, Math.round(pct / 10))
}

export function buildQaRowsFromInterview(result: InterviewResult) {
  return result.answers.map((a, i) => {
    const extended = a as AnswerAnalysis & {
      topic?: string
      rubrics?: RubricRow[]
      performance?: string
    }
    const rubrics = extended.rubrics
    const fb = a.score
    const correctnessScore = rubric100(rubrics, 'correctness')
    const depthScore = rubric100(rubrics, 'depth') ?? fb
    const communicationScore = rubric100(rubrics, 'communication') ?? fb
    const roleSkillsFitScore = rubric100(rubrics, 'roleSkillsFit')
    const accuracy = rubric10(rubrics, 'correctness', fb)
    const clarity = rubric10(rubrics, 'communication', fb)
    const depth = rubric10(rubrics, 'depth', fb)
    const understanding = Math.min(10, Math.round((accuracy + clarity) / 2))
    const total30 = Math.min(30, accuracy + clarity + depth)
    const stars = '★'.repeat(Math.max(1, Math.round(fb / 20))).padEnd(5, '☆')
    const topic =
      extended.topic ||
      result.categories[i % Math.max(result.categories.length, 1)]?.label ||
      'Interview'
    return {
      index: i + 1,
      topic,
      question: a.question,
      questionScore: fb,
      correctnessScore,
      depthScore,
      communicationScore,
      roleSkillsFitScore,
      accuracy,
      clarity,
      understanding,
      depth,
      total30,
      total40: total30,
      stars,
      feedback: a.feedback,
      performance: extended.performance,
    }
  })
}
