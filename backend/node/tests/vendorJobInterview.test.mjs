import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildJdCoveragePlan,
  buildVendorJobSystemPrompt,
  validateVendorJobQuestion,
  localVendorJobQuestion,
  generateVendorJobQuestion,
} from '../prompts/vendorJobInterview.mjs'
import { extractPrimarySkillsFromJd } from '../vendor/atsScore.mjs'
import { AI_ENGINEER_JD, FULL_STACK_RESUME, SALES_JD } from './fixtures/vendorJd.mjs'

test('buildJdCoveragePlan separates AI gaps from full-stack resume', () => {
  const plan = buildJdCoveragePlan({
    jobDescription: AI_ENGINEER_JD,
    requiredSkills: [],
    resumeText: FULL_STACK_RESUME,
  })
  assert.ok(plan.gaps.length >= 3)
  const aiGapHits = plan.gaps.filter((g) =>
    /pytorch|langchain|rag|embedding|hugging|mlops|llm/i.test(g),
  )
  assert.ok(aiGapHits.length >= 3)
  assert.ok(!plan.covered.some((c) => /pytorch/i.test(c)))
})

test('buildVendorJobSystemPrompt mentions jdAnchor and job title', () => {
  const prompt = buildVendorJobSystemPrompt({
    turnNumber: 2,
    totalTurns: 6,
    jobTitle: 'AI Engineer',
    roleTrack: 'AI Engineer',
    level: '3-5 years',
    firstName: 'Jane',
  })
  assert.match(prompt, /jdAnchor/i)
  assert.match(prompt, /turn 2 of 6/i)
  assert.match(prompt, /AI Engineer/)
})

test('validateVendorJobQuestion enforces JD anchor', () => {
  const plan = buildJdCoveragePlan({ jobDescription: AI_ENGINEER_JD, resumeText: FULL_STACK_RESUME })
  const bad = validateVendorJobQuestion(
    {
      text: 'Tell me about your favorite hobby and weekend plans in detail please.',
      category: 'Communication',
      keywords: ['hobby'],
      hint: 'Be brief',
      jdAnchor: 'underwater basket weaving',
      probesGap: false,
    },
    { plan, priorQuestions: [], jobDescription: AI_ENGINEER_JD, turnNumber: 2, totalTurns: 6, gapProbedSoFar: false },
  )
  assert.equal(bad, null)
  const good = validateVendorJobQuestion(
    {
      text: 'Walk me through a RAG pipeline you built — data sources, retrieval, and evaluation.',
      category: 'Technical',
      keywords: ['rag'],
      hint: 'Be specific',
      jdAnchor: 'RAG',
      probesGap: true,
    },
    { plan, priorQuestions: [], jobDescription: AI_ENGINEER_JD, turnNumber: 3, totalTurns: 6, gapProbedSoFar: false },
  )
  assert.ok(good)
  assert.equal(good.jdAnchor, 'RAG')
})

test('localVendorJobQuestion covers six JD-anchored turns for AI JD', () => {
  const plan = buildJdCoveragePlan({
    jobDescription: AI_ENGINEER_JD,
    resumeText: FULL_STACK_RESUME,
  })
  const history = []
  const aiTerms = ['rag', 'langchain', 'pytorch', 'embedding', 'llm', 'mlops', 'hugging', 'vector']
  let gapCount = 0
  const prefixes = new Set()
  for (let turn = 1; turn <= 6; turn++) {
    const q = localVendorJobQuestion({
      turnNumber: turn,
      totalTurns: 6,
      jobTitle: 'AI Engineer',
      level: '3-5 years',
      plan,
      history,
      lastAnswer: 'Sample answer with enough words to continue.',
      firstName: 'Jane',
    })
    assert.ok(q.jdAnchor)
    const prefix = q.text.slice(0, 40).toLowerCase()
    assert.ok(!prefixes.has(prefix))
    prefixes.add(prefix)
    if (q.probesGap) gapCount++
    history.push({ question: q, answer: 'Detailed answer for testing continuity.' })
  }
  const aiQuestionCount = history.filter((h) =>
    aiTerms.some((t) => h.question.text.toLowerCase().includes(t)),
  ).length
  assert.ok(aiQuestionCount >= 4)
  assert.ok(gapCount >= 1)
})

test('generateVendorJobQuestion falls back when the response misses the work slot', async () => {
  const plan = buildJdCoveragePlan({ jobDescription: AI_ENGINEER_JD, resumeText: FULL_STACK_RESUME })
  const q = await generateVendorJobQuestion(
    {
      role: 'AI Engineer',
      jobTitle: 'AI Engineer',
      roleTrack: 'AI Engineer',
      level: '3-5 years',
      jobDescription: AI_ENGINEER_JD,
      plan,
      history: [],
      lastAnswer: '',
      ctx: { name: 'Jane', resumeSnippet: FULL_STACK_RESUME },
    },
    {
      callLlm: async () => ({
        text: JSON.stringify({
          question: {
            text: 'What is your favorite color and why do you like it so much today?',
            category: 'Communication',
            keywords: ['color'],
            hint: 'none',
            jdAnchor: 'not-in-jd',
            probesGap: false,
          },
        }),
      }),
    },
  )
  assert.equal(q.focus, 'structured-work-1')
  assert.match(q.text, /responsibilities/)
})

test('generateVendorJobQuestion accepts valid LLM question', async () => {
  const plan = buildJdCoveragePlan({ jobDescription: AI_ENGINEER_JD, resumeText: FULL_STACK_RESUME })
  const q = await generateVendorJobQuestion(
    {
      role: 'AI Engineer',
      jobTitle: 'AI Engineer',
      roleTrack: 'AI Engineer',
      level: '3-5 years',
      jobDescription: AI_ENGINEER_JD,
      plan,
      history: [],
      lastAnswer: '',
      ctx: { name: 'Jane', resumeSnippet: FULL_STACK_RESUME },
    },
    {
      callLlm: async () => ({
        text: JSON.stringify({
          question: {
            text: 'Describe a work responsibility you owned and how your contribution improved the outcome.',
            category: 'Technical',
            keywords: ['llm', 'quality'],
            hint: 'Metrics and process',
            jdAnchor: 'evaluate LLM output quality',
            probesGap: true,
          },
        }),
      }),
    },
  )
  assert.equal(q.focus, 'structured-work-1')
  assert.equal(q.text, 'Describe a work responsibility you owned and how your contribution improved the outcome.')
})

test('localVendorJobQuestion avoids coding questions for sales JD', () => {
  const plan = buildJdCoveragePlan({ jobDescription: SALES_JD, resumeText: 'Sales rep with CRM experience.' })
  for (let turn = 1; turn <= 6; turn++) {
    const q = localVendorJobQuestion({
      turnNumber: turn,
      totalTurns: 6,
      jobTitle: 'Account Executive',
      level: '3-5 years',
      plan,
      history: [],
      lastAnswer: '',
      firstName: 'Sam',
    })
    const lower = q.text.toLowerCase()
    assert.ok(!lower.includes('algorithm'))
    assert.ok(!/\bapi\b/.test(lower))
    assert.ok(!lower.includes('code'))
  }
})

test('extractPrimarySkillsFromJd finds AI terms in fixture JD', () => {
  const skills = extractPrimarySkillsFromJd(AI_ENGINEER_JD, [])
  const aiHits = skills.filter((s) =>
    /pytorch|langchain|rag|llm|mlops|embedding|hugging|python/i.test(s),
  )
  assert.ok(aiHits.length >= 5)
})
