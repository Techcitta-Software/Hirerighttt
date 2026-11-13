import { describe, expect, it } from 'vitest'
import { computeWeightedScore, isFresherProfile, MIN_ROLE_FIT_WEIGHT } from './interviewWeighting'
import type { Question } from './interviewEngine'

const q = (focus: string, category: string): Question & { focus: string } =>
  ({ id: focus, text: 'Explain it.', category, focus, keywords: [] }) as unknown as Question & { focus: string }
const a = (score: number, rubrics: { id: string; score: number | null }[] = []) => ({ score, answer: 'x', rubrics })

const PLAN = [
  q('structured-fresher-intro', 'Experience'),
  q('structured-theory-2', 'Technical'),
  q('structured-theory-3', 'Technical'),
  q('structured-theory-4', 'Technical'),
  q('structured-project-1', 'Experience'),
  q('structured-project-2', 'Experience'),
  q('structured-closing', 'Communication'),
]

describe('per-question weighting (technical 15, other 10, remainder role fit)', () => {
  it('weights add up: fresher role fit 25, experienced 15', () => {
    const f = computeWeightedScore({ questions: [], analyses: [], fresher: true, roleFitScore: 0 }).model
    expect([f.technicalQuestionWeight, f.otherQuestionWeight, f.roleFitWeight]).toEqual([15, 10, 25])
    expect(computeWeightedScore({ questions: [], analyses: [], fresher: false, roleFitScore: 0 }).model.roleFitWeight).toBe(15)
  })

  it('one answered question can no longer stand for the whole interview', () => {
    expect(computeWeightedScore({ questions: [PLAN[1]], analyses: [a(100)], fresher: true, roleFitScore: 0 }).overall).toBe(15)
    expect(computeWeightedScore({ questions: [PLAN[0]], analyses: [a(100)], fresher: true, roleFitScore: 0 }).overall).toBe(10)
  })

  it('perfect answers and perfect role fit give exactly 100; the closing question is not scored', () => {
    const out = computeWeightedScore({ questions: PLAN, analyses: PLAN.map(() => a(100)), fresher: true, roleFitScore: 100 })
    expect(out.overall).toBe(100)
    expect(out.model.rows).toHaveLength(6)
  })

  it('role fit fills the remainder', () => {
    expect(computeWeightedScore({ questions: [], analyses: [], fresher: true, roleFitScore: 100 }).overall).toBe(25)
  })

  it('dimensions count unanswered questions as 0 and never invent an unevaluated dimension', () => {
    const out = computeWeightedScore({
      questions: [PLAN[1]],
      analyses: [a(50, [{ id: 'communication', score: 50 }, { id: 'depth', score: 50 }])],
      fresher: true,
      roleFitScore: 70,
    })
    const dims = Object.fromEntries(out.dimensions.map((d) => [d.id, d.score]))
    expect(dims.communication).toBe(10)
    expect(dims.roleSkillsFit).toBe(70)
    expect(dims.correctness).toBeUndefined()
  })

  it('a very long interview still totals at most 100', () => {
    const qs = [...Array.from({ length: 9 }, () => q('structured-theory-2', 'Technical')), ...Array.from({ length: 3 }, () => q('structured-project-1', 'Experience'))]
    const out = computeWeightedScore({ questions: qs, analyses: qs.map(() => a(100)), fresher: true, roleFitScore: 100 })
    expect(out.overall).toBe(100)
    expect(out.model.roleFitWeight).toBeGreaterThanOrEqual(MIN_ROLE_FIT_WEIGHT)
  })
})

describe('isFresherProfile', () => {
  it('a real job means not a fresher; internships do not count', () => {
    expect(isFresherProfile({ totalExperience: '0 – 1 Years', workExperiences: [{ company: 'Acme', jobTitle: 'Engineer' }] })).toBe(false)
    expect(isFresherProfile({ totalExperience: '', workExperiences: [{ company: 'Acme', jobTitle: 'Software Intern' }] })).toBe(true)
    expect(isFresherProfile({ totalExperience: 'Fresher / 0 years' })).toBe(true)
  })
})
