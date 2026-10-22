import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { buildStructuredTurnQuestion, structuredPlanSummary, recommendTopSkillsForRole, isPlanFresher, questionMatchesPlan } from '../interviewQuestionPlan.mjs'
import { generateAdaptiveQuestionLocal } from '../interviewAgent.mjs'
import { generateVendorJobQuestion } from '../prompts/vendorJobInterview.mjs'

const source = await readFile(new URL('../../../frontend/src/lib/interviewQuestionPlan.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const frontend = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const experienced = { currentRole: 'Frontend Developer', totalExperience: '6 years', skills: ['Communication', 'React', 'TypeScript'], workExperiences: [{ jobTitle: 'Senior frontend engineer with platform responsibilities', company: 'Example Company' }], certifications: [{ name: 'Web Accessibility' }] }
const fresh = { currentRole: 'Software Engineer', totalExperience: 'Fresher', skills: ['Communication', 'Python', 'React'], workExperiences: [] }
const ctxFor = p => ({ name: 'Sam', role: p.currentRole, skills: p.skills, jobs: p.workExperiences.map(w => `${w.jobTitle} at ${w.company}`), certs: p.certifications?.map(c => c.name) || [], achievements: [], resumeSnippet: '' })

test('experienced candidates receive two work, two theory, credential, closing; frontend parity', () => {
  const ctx = ctxFor(experienced)
  const history = []
  const questions = []
  for (let turnNumber = 1; turnNumber <= 6; turnNumber++) {
    const args = { turnNumber, first: 'Sam', level: '6 years', profile: experienced, ctx, history }
    const q = buildStructuredTurnQuestion(args)
    assert.deepEqual(q, frontend.buildStructuredTurnQuestion(args))
    assert.equal(questionMatchesPlan(q, structuredPlanSummary(experienced.currentRole, ctx, experienced, '6 years'), turnNumber), true)
    questions.push(q); history.push({ question: q, answer: 'A detailed response about the question.' })
  }
  assert.deepEqual(questions.map(q => q.focus), ['structured-work-1', 'structured-work-2', 'structured-theory-3', 'structured-theory-4', 'structured-cert', 'structured-closing'])
  assert.deepEqual(questions.slice(2, 4).map(q => q.topic), ['React.js', 'TypeScript'])
  assert.match(questions[2].text, /reconciliation/)
  for (const q of questions.slice(2, 4)) { assert.equal(q.resumeAnchor, undefined); assert.doesNotMatch(q.text, /résumé|you used|you built/i) }
  assert.equal(new Set(questions.map(q => q.text.slice(0, 40))).size, 6)
})

test('freshers get a known language and SQL, no employment questions', () => {
  const ctx = ctxFor(fresh)
  const questions = Array.from({ length: 6 }, (_, i) => buildStructuredTurnQuestion({ turnNumber: i + 1, first: 'Sam', level: '0–1 years', profile: fresh, ctx }))
  assert.deepEqual(questions.slice(0, 2).map(q => q.topic), ['Python', 'SQL'])
  assert.deepEqual(questions.slice(2, 4).map(q => q.focus), ['structured-project-3', 'structured-project-4'])
  assert.match(questions[4].text, /improve/)
  assert.ok(questions.every(q => !/your employer|your work as|responsibilities did you own/i.test(q.text)))
})

test('role skills ignore unrelated profile keywords; months do not become senior years', () => {
  assert.deepEqual(recommendTopSkillsForRole('Frontend Developer', { skills: ['Cooking', 'Communication'], resumeSnippet: 'Cooking and communication' }).slice(0, 2), ['React.js', 'TypeScript'])
  assert.deepEqual(recommendTopSkillsForRole('Python Developer', {}).slice(0, 2), ['Python', 'SQL'])
  const q = buildStructuredTurnQuestion({ turnNumber: 3, first: '', level: '6 months', profile: { ...experienced, totalExperience: '6 months' }, ctx: ctxFor(experienced) })
  assert.match(q.text, /props and state/)
  assert.equal(isPlanFresher({ totalExperience: '4 years' }, {}, '4 years'), false)
  assert.equal(isPlanFresher({ totalExperience: '0' }, {}, ''), true)
})

test('missing language does not invent a known skill; complete summary has six slots', () => {
  const plan = structuredPlanSummary('Software Engineer', {}, null, 'Fresher')
  assert.deepEqual(plan.recommendedSkills, ['a programming language you know', 'SQL'])
  assert.equal(plan.turnPlan.length, 6)
  assert.equal(plan.turnPlan[5].startsWith('Q6'), true)
})

test('adaptive local fallback stays in every planned slot even for a long employer title', () => {
  const history = []
  for (let turn = 1; turn <= 6; turn++) {
    const q = generateAdaptiveQuestionLocal({ profile: experienced, role: experienced.currentRole, level: '6 years', history, lastAnswer: 'I used Python for something else.' })
    assert.equal(questionMatchesPlan(q, structuredPlanSummary(experienced.currentRole, ctxFor(experienced), experienced, '6 years'), turn), true)
    history.push({ question: q, answer: 'A complete answer.' })
  }
})

test('vendor model retries résumé-based theory and falls back to the correct concept', async () => {
  let calls = 0
  const history = [1, 2].map(n => ({ question: { text: `Earlier work question ${n}` }, answer: 'Work answer' }))
  const q = await generateVendorJobQuestion({ profile: experienced, ctx: ctxFor(experienced), role: experienced.currentRole, level: '6 years', history }, { callLlm: async ({ user }) => {
    calls++
    const payload = JSON.parse(user)
    assert.equal(payload.candidateSummary, undefined)
    return { text: JSON.stringify({ question: { text: 'In your project, explain how you used React.js to build the interface.', topic: 'React.js' } }) }
  } })
  assert.equal(calls, 2)
  assert.equal(q.focus, 'structured-theory-3')
  assert.match(q.text, /reconciliation/)
  assert.equal(questionMatchesPlan({ text: 'Explain SQL joins and their differences.', topic: 'React.js' }, structuredPlanSummary(experienced.currentRole, ctxFor(experienced), experienced, '6 years'), 3), false)
})
