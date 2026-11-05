import { describe, expect, it } from 'vitest'
import { defaultAnalysisSteps, setAnalysisStep } from './InterviewCompletionPanel'

describe('InterviewCompletionPanel helpers', () => {
  it('starts with wrap_up active', () => {
    const steps = defaultAnalysisSteps()
    expect(steps[0]?.id).toBe('wrap_up')
    expect(steps[0]?.status).toBe('active')
    expect(steps.slice(1).every((s) => s.status === 'pending')).toBe(true)
  })

  it('marks prior steps done when advancing', () => {
    let steps = defaultAnalysisSteps()
    steps = setAnalysisStep(steps, 'wrap_up', 'done')
    steps = setAnalysisStep(steps, 'save_integrity', 'active')
    expect(steps.find((s) => s.id === 'wrap_up')?.status).toBe('done')
    expect(steps.find((s) => s.id === 'save_integrity')?.status).toBe('active')
    steps = setAnalysisStep(steps, 'score_answers', 'active')
    expect(steps.find((s) => s.id === 'save_integrity')?.status).toBe('done')
    expect(steps.find((s) => s.id === 'store_recording')?.status).toBe('done')
  })
})
