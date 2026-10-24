import { describe, expect, it } from 'vitest'
import { buildInterviewInsights, toCandidateDimension } from './interviewInsightsPresentation'
import type { InterviewResult } from './store'

describe('interviewInsightsPresentation', () => {
  it('maps internal rubric labels to candidate-facing titles', () => {
    const dim = toCandidateDimension('Answer Correctness', 13, 'Frontend Developer')
    expect(dim.title).toBe('Role fit')
    expect(dim.title).not.toMatch(/correctness/i)
  })

  it('uses per-interview improvements when present', () => {
    const interview: InterviewResult = {
      role: 'Frontend Developer',
      level: 'Mid',
      date: new Date().toISOString(),
      overall: 10,
      categories: [
        { label: 'Answer Correctness', score: 13 },
        { label: 'Depth', score: 17 },
        { label: 'Communication', score: 17 },
      ],
      strengths: [],
      improvements: ['Add measurable outcomes when describing React projects.'],
      answers: [],
    }
    const insights = buildInterviewInsights(interview)
    expect(insights.focusNext[0]).toContain('measurable outcomes')
    expect(insights.dimensions[0].title).toBe('Role fit')
  })
})
