import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluatePair } from '../interviewResults/evaluator.mjs'
import { buildQaPair } from '../interviewResults/logic.mjs'

test('evaluatePair skipped does not call llm', async () => {
  let calls = 0
  const pair = buildQaPair({
    questionIndex: 0,
    question: { text: 'Q', keywords: [] },
    answer: '',
    skipped: true,
  })
  const ev = await evaluatePair({
    pair,
    ctx: { role: 'Dev', level: '1–3 years', skills: [], jobs: [] },
    llm: async () => {
      calls++
      return { text: '{"score":99,"relevance":10,"accuracy":10,"clarity":10,"depth":10,"feedback":"x"}' }
    },
    timeoutMs: 100,
  })
  assert.equal(calls, 0)
  assert.equal(ev.status, 'skipped')
  assert.equal(ev.score, 0)
})

test('evaluatePair uses llm json when valid', async () => {
  const pair = buildQaPair({
    questionIndex: 0,
    question: { text: 'Explain React hooks.', keywords: ['react'] },
    answer: 'Hooks let function components use state and effects in React applications with useState.',
    skipped: false,
  })
  const ev = await evaluatePair({
    pair,
    ctx: { role: 'Frontend', level: '1–3 years', skills: ['React'], jobs: [] },
    llm: async () => ({
      text: '{"score":75,"relevance":8,"accuracy":7,"clarity":8,"depth":7,"feedback":"Solid."}',
      model: 'test-model',
    }),
    timeoutMs: 500,
  })
  assert.equal(ev.status, 'scored')
  assert.equal(ev.score, 75)
  assert.equal(ev.source, 'llm')
})

test('evaluatePair falls back when llm throws', async () => {
  const pair = buildQaPair({
    questionIndex: 0,
    question: { text: 'Explain caching.', keywords: ['cache'] },
    answer: 'I used Redis caching to reduce latency by 40 percent in production with measurable outcomes.',
    skipped: false,
  })
  const ev = await evaluatePair({
    pair,
    ctx: { role: 'Backend', level: '3–5 years', skills: ['Redis'], jobs: [] },
    llm: async () => {
      throw new Error('down')
    },
    timeoutMs: 100,
  })
  assert.equal(ev.status, 'fallback')
  assert.equal(ev.source, 'heuristic')
  assert.ok(ev.score >= 0 && ev.score <= 100)
})

test('evaluatePair falls back on llm timeout', async () => {
  const pair = buildQaPair({
    questionIndex: 0,
    question: { text: 'Q', keywords: [] },
    answer: 'A detailed answer with enough words to score reasonably well in the heuristic path here.',
    skipped: false,
  })
  const ev = await evaluatePair({
    pair,
    ctx: { role: 'Dev', level: '1–3 years', skills: [], jobs: [] },
    llm: () => new Promise(() => {}),
    timeoutMs: 50,
  })
  assert.equal(ev.status, 'fallback')
})
