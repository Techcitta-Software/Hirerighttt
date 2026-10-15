import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePlan, validateEvaluation, validateCompetencies, validateResumeAnalysis, aggregate, publicQuestion } from '../assessment/contracts.mjs'
import { quickResponse, detectIntent } from '../assessment/quickResponses.mjs'
import { structuredCall } from '../assessment/provider.mjs'
import { extractResume } from '../assessment/resumes.mjs'

export const job = { description: 'Handle customer support issues', competencies: Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, name: `Competency ${i}`, requirement: `Requirement ${i}`, weight: i === 6 ? 10 : 15 })) }
export function plan() {
  return { questions: job.competencies.map((c, i) => ({ question_id: `q${i}`, question_text: `How would you handle scenario ${i}?`, competency: c.id, difficulty: 'intermediate', question_type: 'scenario', selection_reason: 'Job requirement', resume_or_job_evidence: c.requirement, expected_answer_points: ['Explain an approach'], scoring_rubric: { 0: 'No evidence', 1: 'Major gaps', 2: 'Some correct reasoning', 3: 'Correct approach', 4: 'Correct with tradeoffs' }, suggested_follow_up: 'How would you validate that?', max_score: 4 })) }
}
export const evaluation = { score: 3, evidence: ['verify the outcome'], strengths: ['Verification'], gaps: [], reasoning: 'The response demonstrates verification', confidence: 0.8, needs_human_review: false, review_reason: '' }

test('plan requires seven distinct, grounded questions and complete rubrics', () => {
  assert.equal(validatePlan(plan(), job).questions.length, 7)
  const cases = [p => p.questions.pop(), p => { p.questions[1].question_text = p.questions[0].question_text }, p => { p.questions[0].resume_or_job_evidence = 'Invented work history' }, p => { delete p.questions[0].scoring_rubric[4] }, p => { p.questions[0].competency = 'invented' }]
  for (const mutate of cases) { const value = plan(); mutate(value); assert.throws(() => validatePlan(value, job)) }
  assert.throws(() => validateCompetencies(job.competencies.map(c => ({ ...c, weight: 1 }))))
})
test('candidate question representation hides evidence, rubric and follow-up', () => {
  const question = publicQuestion(plan().questions[0])
  assert.equal(question.scoring_rubric, undefined)
  assert.equal(question.expected_answer_points, undefined)
  assert.equal(question.suggested_follow_up, undefined)
})
test('quick responses distinguish apologies, repetition, skip and substantive content', () => {
  for (const word of ['Hi', 'Hello!', 'hey', 'Hlo']) assert.equal(detectIntent(word), 'greeting')
  assert.equal(detectIntent("I'm sorry."), 'apology')
  assert.equal(detectIntent('I would skip the cache and query the database'), null)
  assert.equal(detectIntent('Hello, I would verify the outcome'), null)
  assert.equal(quickResponse('Can you repeat the question?', plan().questions[0]).response, `Of course! Here is the question again: ${plan().questions[0].question_text}`)
  assert.equal(quickResponse('Can I skip this question?', null).confirmation_required, true)
})
test('evaluation rejects invented evidence and invalid scores', () => {
  assert.equal(validateEvaluation(evaluation, 'I verify the outcome').score, 3)
  assert.throws(() => validateEvaluation(evaluation, 'Another answer'))
  for (const score of [-1, 5, 1.5, '3']) assert.throws(() => validateEvaluation({ ...evaluation, score }, 'I verify the outcome'))
  assert.equal(validateEvaluation({ ...evaluation, confidence: 0.2 }, 'I verify the outcome').needs_human_review, true)
})
test('aggregation does not silently score skipped or missing answers as zero', () => {
  const questions = validatePlan(plan(), job).questions
  const answers = questions.map((q, i) => ({ id: `a${i}`, question_id: q.question_id }))
  const evaluations = answers.map((a, i) => ({ id: `e${i}`, answer_id: a.id, data: evaluation }))
  assert.equal(aggregate(job, questions, answers, evaluations).overall, 75)
  assert.equal(aggregate(job, questions, answers, evaluations.slice(1)).overall, null)
  assert.equal(aggregate(job, questions, answers, evaluations, [{ evaluation_id: 'e0', score: 4 }]).overall, 78.75)
})
test('provider retries invalid JSON and stops after two attempts without leaking provider errors', async () => {
  const old = process.env.LLM_API_KEY
  process.env.LLM_API_KEY = 'test-only-placeholder'
  let calls = 0
  try {
    await assert.rejects(structuredCall({ system: 'test', payload: {}, purpose: 'evaluation', validate: v => v, fetchImpl: async () => { calls++; return { ok: true, json: async () => ({ choices: [{ message: { content: 'not json' } }] }) } } }), /invalid output/)
    assert.equal(calls, 2)
  } finally { if (old === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = old }
})
test('resume rejects unsupported extensions, bad signatures and oversized uploads', async () => {
  await assert.rejects(extractResume({ filename: 'resume.exe', file_base64: 'AA==' }))
  await assert.rejects(extractResume({ filename: 'resume.pdf', file_base64: Buffer.from('not a pdf').toString('base64') }))
  await assert.rejects(extractResume({ filename: 'resume.docx', file_base64: 'A'.repeat(2800001) }))
})
test('resume analysis preserves uncertainty and rejects invented source evidence', () => {
  const result = validateResumeAnalysis({ claims: [{ type: 'skill', value: 'Support', evidence: 'Customer support' }], uncertainties: ['Duration not stated'] }, 'Customer support experience')
  assert.equal(result.claims[0].uncertain, true)
  assert.equal(result.requires_candidate_review, true)
  assert.throws(() => validateResumeAnalysis({ claims: [{ type: 'experience', value: '5 years', evidence: '5 years' }], uncertainties: [] }, 'Customer support experience'))
})
