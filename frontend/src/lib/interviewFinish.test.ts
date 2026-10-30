import { describe, expect, it } from 'vitest'
import {
  UNANSWERED_ANSWER_LABEL,
  collectInterviewPairs,
  hasSubstantiveInterviewProgress,
} from './interviewFinish'

describe('collectInterviewPairs', () => {
  it('includes questions with no answer for the report', () => {
    const q = { text: 'Explain your React project.', category: 'Technical' as const, keywords: [] }
    const paired = collectInterviewPairs([], [], [{ question: q, answer: '' }])
    expect(paired.questions).toHaveLength(1)
    expect(paired.answers[0]).toBe(UNANSWERED_ANSWER_LABEL)
  })

  it('keeps substantive answers unchanged', () => {
    const q = { text: 'Explain your React project.', category: 'Technical' as const, keywords: [] }
    const paired = collectInterviewPairs([], [], [{ question: q, answer: 'I built a dashboard with hooks.' }])
    expect(paired.answers[0]).toBe('I built a dashboard with hooks.')
  })
})

describe('hasSubstantiveInterviewProgress', () => {
  it('does not treat silent skips as substantive progress', () => {
    const q = { text: 'Q1', category: 'Technical' as const, keywords: [] }
    expect(hasSubstantiveInterviewProgress([], [{ question: q, answer: '' }], '')).toBe(false)
  })
})
