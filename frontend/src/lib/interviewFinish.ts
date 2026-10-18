import type { Question } from './interviewEngine'

export type InterviewHistoryTurn = { question: Question; answer: string }

/** Build scored Q/A pairs for early leave (history + in-progress answers). */
export function collectInterviewPairs(
  questions: Question[],
  finalAnswers: string[],
  history: InterviewHistoryTurn[],
): { questions: Question[]; answers: string[] } {
  const qOut: Question[] = []
  const aOut: string[] = []
  const seen = new Set<string>()

  for (const turn of history) {
    const a = turn.answer?.trim()
    const text = turn.question?.text?.trim()
    if (!a || !text || seen.has(text)) continue
    seen.add(text)
    qOut.push(turn.question)
    aOut.push(a)
  }

  for (let i = 0; i < Math.max(questions.length, finalAnswers.length); i++) {
    const a = finalAnswers[i]?.trim()
    const q = questions[i]
    const text = q?.text?.trim()
    if (!a || !text || seen.has(text)) continue
    seen.add(text)
    qOut.push(q)
    aOut.push(a)
  }

  return { questions: qOut, answers: aOut }
}

export function hasSubstantiveInterviewProgress(
  finalAnswers: string[],
  history: InterviewHistoryTurn[],
  draft: string,
  minChars = 10,
): boolean {
  if (draft.trim().length >= minChars) return true
  if (history.some((h) => h.answer?.trim().length >= minChars)) return true
  return finalAnswers.some((a) => a?.trim().length >= minChars)
}
