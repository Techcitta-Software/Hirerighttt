import assert from 'node:assert/strict'
import test from 'node:test'
import { generateAdaptiveQuestion, generateAdaptiveQuestionLocal } from '../interviewAgent.mjs'
import { buildStructuredTurnQuestion, structuredPlanSummary } from '../interviewQuestionPlan.mjs'

test('generateAdaptiveQuestion requires Gemini — no static fallback', async () => {
  const prev = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  }
  delete process.env.GEMINI_API_KEY
  delete process.env.GOOGLE_API_KEY

  await assert.rejects(
    () =>
      generateAdaptiveQuestion({
        ctx: { skills: ['Python'], name: 'Test', jobs: [], achievements: [], certs: [], resumeSnippet: '' },
        role: 'AI Associate Engineer',
        level: '1–3 years',
        history: [],
        lastAnswer: '',
      }),
    (err) => err?.code === 'LLM_QUESTION_REQUIRED',
  )

  assert.throws(() => generateAdaptiveQuestionLocal(), (err) => err?.code === 'LLM_QUESTION_REQUIRED')

  for (const [key, value] of Object.entries(prev)) {
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
})

test('structured plan builder still validates slot shapes (tests only)', () => {
  const ctx = { skills: ['Python', 'FastAPI'], resumeSnippet: 'Python APIs' }
  const plan = structuredPlanSummary('AI Associate Engineer', ctx, { totalExperience: '2 years' }, '2 years')
  const q = buildStructuredTurnQuestion({
    turnNumber: 2,
    first: 'Sam',
    level: '2 years',
    profile: { totalExperience: '2 years' },
    ctx,
    roleOverride: 'AI Associate Engineer',
    planSummary: plan,
    varietySeed: 'plan-test',
  })
  assert.ok(q?.text && q.text.length >= 24)
})
