import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validateAnswerPayload,
  parseEvaluation,
  mergeQaPair,
  computeFinalScore,
  candidateRowFromUserAndProfile,
  buildQaPair,
  MAX_ANSWER_CHARS,
} from '../interviewResults/logic.mjs'

test('validateAnswerPayload rejects missing sessionId', () => {
  assert.equal(validateAnswerPayload({ questionIndex: 0, question: { text: 'Q?' } }).ok, false)
})

test('validateAnswerPayload rejects bad questionIndex', () => {
  const base = { sessionId: 'abc', question: { text: 'Q?' }, answer: 'hi' }
  assert.equal(validateAnswerPayload({ ...base, questionIndex: -1 }).ok, false)
  assert.equal(validateAnswerPayload({ ...base, questionIndex: 1.5 }).ok, false)
  assert.equal(validateAnswerPayload({ ...base, questionIndex: 50 }).ok, false)
})

test('validateAnswerPayload marks skipped answers', () => {
  const r = validateAnswerPayload({
    sessionId: 's1',
    questionIndex: 0,
    question: { text: 'Tell me about React.' },
    answer: '(Answer skipped by candidate)',
  })
  assert.equal(r.ok, true)
  assert.equal(r.value.skipped, true)
  assert.equal(r.value.answer, '')
})

test('validateAnswerPayload truncates long answers', () => {
  const r = validateAnswerPayload({
    sessionId: 's1',
    questionIndex: 0,
    question: { text: 'Q' },
    answer: 'x'.repeat(10000),
  })
  assert.equal(r.ok, true)
  assert.equal(r.value.answer.length, MAX_ANSWER_CHARS)
})

test('parseEvaluation handles fenced JSON and clamps', () => {
  const ev = parseEvaluation('Here: ```json\n{"score":82,"relevance":9,"accuracy":8,"clarity":7,"depth":6,"feedback":"Good"}\n```')
  assert.ok(ev)
  assert.equal(ev.score, 82)
  assert.equal(ev.status, 'scored')
  const clamped = parseEvaluation('{"score":150,"clarity":-3,"relevance":8,"accuracy":8,"depth":8}')
  assert.equal(clamped.score, 100)
  assert.equal(clamped.criteria.clarity, 0)
})

test('parseEvaluation derives score from criteria', () => {
  const ev = parseEvaluation('{"relevance":8,"accuracy":8,"clarity":6,"depth":6,"feedback":"ok"}')
  assert.equal(ev.score, 70)
})

test('parseEvaluation returns null for garbage', () => {
  assert.equal(parseEvaluation('not json'), null)
})

test('mergeQaPair sorts and replaces by index', () => {
  const p0 = buildQaPair({ questionIndex: 0, question: { text: 'A' }, answer: 'one', skipped: false })
  const p2 = buildQaPair({ questionIndex: 2, question: { text: 'C' }, answer: 'three', skipped: false })
  let arr = mergeQaPair([], p2)
  arr = mergeQaPair(arr, p0)
  assert.deepEqual(arr.map((p) => p.questionIndex), [0, 2])
  const p0b = buildQaPair({ questionIndex: 0, question: { text: 'A' }, answer: 'updated', skipped: false })
  arr = mergeQaPair(arr, p0b)
  assert.equal(arr.length, 2)
  assert.equal(arr[0].answer, 'updated')
})

test('computeFinalScore averages scored and counts skipped as zero', () => {
  const a = buildQaPair({ questionIndex: 0, question: { text: 'Q' }, answer: 'a', skipped: false })
  a.evaluation = { status: 'scored', score: 80 }
  const b = buildQaPair({ questionIndex: 1, question: { text: 'Q' }, answer: 'b', skipped: false })
  b.evaluation = { status: 'scored', score: 60 }
  const pending = buildQaPair({ questionIndex: 2, question: { text: 'Q' }, answer: 'd', skipped: false })
  const r = computeFinalScore([a, b, pending])
  assert.equal(r.finalScore, 70)
  assert.equal(r.scoredCount, 2)
  assert.equal(r.answerCount, 3)
})

test('computeFinalScore 90 and skipped yields 45', () => {
  const a = buildQaPair({ questionIndex: 0, question: { text: 'Q' }, answer: 'a', skipped: false })
  a.evaluation = { status: 'scored', score: 90 }
  const b = buildQaPair({ questionIndex: 1, question: { text: 'Q' }, answer: '', skipped: true })
  const r = computeFinalScore([a, b])
  assert.equal(r.finalScore, 45)
})

test('computeFinalScore all pending returns null', () => {
  const p = buildQaPair({ questionIndex: 0, question: { text: 'Q' }, answer: 'x', skipped: false })
  const r = computeFinalScore([p])
  assert.equal(r.finalScore, null)
})

test('candidateRowFromUserAndProfile dedupes skills and uses hash', () => {
  const row = candidateRowFromUserAndProfile(
    { id: 'u1', email: 'a@b.com', name: 'Ann', passwordHash: 'scrypt$abc$def' },
    null,
  )
  assert.deepEqual(row.resume_skills, [])
  assert.equal(row.password_hash, 'scrypt$abc$def')
  assert.equal(row.username, 'Ann')
  assert.ok(!('password' in row))
  const row2 = candidateRowFromUserAndProfile(
    { id: 'u1', email: 'a@b.com', name: 'Ann', passwordHash: 'scrypt$x' },
    { skills: ['React', 'react', ' Node '] },
  )
  assert.deepEqual(row2.resume_skills, ['React', 'Node'])
})
