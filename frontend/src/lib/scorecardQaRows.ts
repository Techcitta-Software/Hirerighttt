import type { AnswerAnalysis, InterviewResult } from './store'

type RubricRow = { id?: string; score: number }

function rubric10(rubrics: RubricRow[] | undefined, id: string, fallback: number): number {
  const hit = rubrics?.find((r) => r.id === id)
  return Math.min(10, Math.round((hit?.score ?? fallback) / 10))
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
