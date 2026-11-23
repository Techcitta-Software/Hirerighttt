import { describe, expect, it } from 'vitest'
import { computeQuestionRoleSkillsFit, computeRoleSkillsFit } from './roleSkillsFitScoring'

const ctx = { skills: ['Node.js', 'PostgreSQL'], resumeSnippet: 'Node.js and PostgreSQL developer' }
const req = ['Node.js', 'PostgreSQL', 'REST APIs']
const questions = [
  { text: 'How does the Node.js event loop handle concurrency?', topic: 'Node.js' },
  { text: 'Explain how indexes work in PostgreSQL.', topic: 'PostgreSQL' },
  { text: 'How would you design versioned REST APIs?', topic: 'REST APIs' },
]
const strong = ['The event loop hands I/O to libuv...', 'A B-tree index lets the planner skip a scan...', 'Version in the URL path...']
const weak = ['Not sure.', 'Indexes are a database thing.', 'Never done it.']

describe('role skills fit (same rule as the API)', () => {
  it('is deterministic', () => {
    const runs = Array.from({ length: 5 }, () => computeRoleSkillsFit(ctx, req, questions, strong, [82, 78, 74]))
    for (const r of runs) expect(r).toEqual(runs[0])
  })

  it('gives 40 points for the resume and 60 for the interview per skill', () => {
    const out = computeRoleSkillsFit(ctx, req, questions, strong, [82, 78, 74])
    expect(out.skills?.map((s) => s.points)).toEqual([100, 100, 60])
    expect(out.fitScore).toBe(87) // round(260 / 3), as Python's round() gives
    expect(out.missingSkills).toEqual([])
  })

  it('ranks a strong candidate above a weak one', () => {
    const s = computeRoleSkillsFit(ctx, req, questions, strong, [82, 78, 74])
    const w = computeRoleSkillsFit(ctx, req, questions, weak, [10, 20, 5])
    expect(s.fitScore).toBeGreaterThan(w.fitScore)
    expect(w.missingSkills).toEqual(['REST APIs'])
    expect(w.fitScore).toBe(27) // round((40 + 40 + 0) / 3)
  })

  it('per-question rubric uses the same points and skips questions about no required skill', () => {
    expect(computeQuestionRoleSkillsFit(questions[0], 'Node.js event loop', ctx, req)).toBe(100)
    expect(computeQuestionRoleSkillsFit(questions[2], 'nothing relevant', ctx, req)).toBe(0)
    expect(computeQuestionRoleSkillsFit({ text: 'Tell me about yourself' }, 'hi', ctx, req)).toBeNull()
  })
})
