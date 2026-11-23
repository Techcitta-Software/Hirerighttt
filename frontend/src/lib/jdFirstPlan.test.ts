import { describe, expect, it } from 'vitest'
import {
  JD_INTERVIEW_SCORED_QUESTIONS,
  JD_INTERVIEW_TURN_COUNT,
  jdFirstSlotOrder,
  jdQuestionMix,
  questionsFitJdMix,
} from './interviewQuestionPlan'

describe('JD-first question plan (job-link interviews)', () => {
  it('is ~80% JD, ~20% resume-to-JD alignment and always has a behavioural question', () => {
    expect(jdQuestionMix()).toEqual({ jd: 6, 'jd-alignment': 2, behavioural: 1 })
    for (const n of [5, 7, 9, 12]) {
      const mix = jdQuestionMix(n)
      expect(mix.behavioural).toBeGreaterThanOrEqual(1)
      expect(mix['jd-alignment']).toBeGreaterThanOrEqual(1)
      expect((mix.jd + mix.behavioural) / n).toBeGreaterThanOrEqual(0.7)
    }
  })

  it('matches the backend slot order (alignment opener, behavioural mid-interview)', () => {
    expect(jdFirstSlotOrder()).toEqual([
      'jd-alignment', 'jd', 'jd', 'jd', 'behavioural', 'jd', 'jd', 'jd-alignment', 'jd',
    ])
    expect(JD_INTERVIEW_TURN_COUNT).toBe(JD_INTERVIEW_SCORED_QUESTIONS + 1)
  })

  it('validates a received question set against the mix', () => {
    const ok = jdFirstSlotOrder().map((planSlot) => ({ planSlot }))
    expect(questionsFitJdMix(ok)).toBe(true)
    const noBehavioural = ok.map((q) => (q.planSlot === 'behavioural' ? { planSlot: 'jd' } : q))
    expect(questionsFitJdMix(noBehavioural)).toBe(false)
    const resumeHeavy = ok.map((q, i) => (i < 5 ? { planSlot: 'jd-alignment' } : q))
    expect(questionsFitJdMix(resumeHeavy)).toBe(false)
    expect(questionsFitJdMix([{}, {}])).toBe(false)
  })
})
