import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateKeywordMatch,
  computeEmployerInterviewComposite,
  computeFinalAtsScore,
  normalizeSkill,
  parseResumeStructure,
} from '../atsScorer.mjs'
import { analyzeInterviewSkillMatch, generateAdaptiveQuestionLocal } from '../interviewAgent.mjs'
import { evaluateResumeAgainstJd } from '../vendor/aiEvaluation.mjs'

test('normalizeSkill maps synonyms', () => {
  assert.equal(normalizeSkill('ReactJS'), 'react')
  assert.equal(normalizeSkill('NodeJS'), 'node.js')
})

test('calculateKeywordMatch weights required over preferred', () => {
  const result = calculateKeywordMatch(
    ['react', 'typescript'],
    'Built with React and TypeScript',
    ['react', 'docker'],
    ['graphql'],
  )
  assert.ok(result.matchedSkills.includes('react'))
  assert.ok(result.missingRequiredSkills.includes('docker'))
  assert.ok(result.score < 100)
})

test('computeFinalAtsScore is stable for same inputs', () => {
  const resume =
    'john@example.com github.com/john Built React TypeScript Node.js apps serving 10,000+ users with 40% latency reduction.'
  const parsed = parseResumeStructure(resume)
  const a = computeFinalAtsScore({
    rawResumeText: resume,
    parsedResume: parsed,
    jobDescription: {
      requiredSkills: ['React', 'TypeScript', 'Docker'],
      preferredSkills: ['GraphQL'],
    },
    llmEvaluation: { semanticProjectScore: 80, experienceScore: 70, educationScore: 75 },
  })
  const b = computeFinalAtsScore({
    rawResumeText: resume,
    parsedResume: parsed,
    jobDescription: {
      requiredSkills: ['React', 'TypeScript', 'Docker'],
      preferredSkills: ['GraphQL'],
    },
    llmEvaluation: { semanticProjectScore: 80, experienceScore: 70, educationScore: 75 },
  })
  assert.equal(a.overallScore, b.overallScore)
  assert.ok(a.overallScore > 50)
  assert.ok(
    a.missingKeywords.some((s) => String(s).toLowerCase() === 'docker'),
    `expected docker in missing keywords, got ${a.missingKeywords.join(',')}`,
  )
})

test('computeEmployerInterviewComposite blends interview and ATS', () => {
  const c = computeEmployerInterviewComposite(80, 60)
  assert.equal(c.interviewScore, 80)
  assert.equal(c.atsScore, 60)
  assert.equal(c.compositeScore, Math.round(80 * 0.65 + 60 * 0.35))
})

test('theory turn uses role-relevant skills when job description is attached', () => {
  const jd =
    'Senior backend engineer. Must know Kafka, Redis, and Go. Build distributed event streaming.'
  const ctx = {
    name: 'Alex',
    skills: ['Kafka', 'Redis'],
    jobs: ['Backend Engineer: Acme'],
    achievements: [],
    resumeSnippet: 'Kafka Redis Go microservices',
  }
  const profile = {
    resumeText: 'Experience with Kafka and Redis in production.',
    skills: ['Kafka', 'Redis'],
    workExperiences: [{ jobTitle: 'Backend Engineer', company: 'Acme', description: 'Streaming' }],
  }
  const q1 = generateAdaptiveQuestionLocal({
    role: 'Backend Engineer',
    level: '2–5 years',
    jobDescription: jd,
    history: [],
    lastAnswer: '',
    profile,
    ctx,
  })
  assert.match(String(q1.focus || ''), /^structured-work-/)

  const q2 = generateAdaptiveQuestionLocal({
    role: 'Backend Engineer',
    level: '2–5 years',
    jobDescription: jd,
    history: [{ question: q1, answer: 'Owned ingestion pipeline and cut lag 40%.' }],
    lastAnswer: 'Owned ingestion pipeline and cut lag 40%.',
    profile,
    ctx,
  })
  const history = [
    { question: q1, answer: 'Owned ingestion pipeline and cut lag 40%.' },
    { question: q2, answer: 'Debugged partition skew with better keys and monitoring.' },
  ]
  const q3 = generateAdaptiveQuestionLocal({
    role: 'Backend Engineer',
    level: '2–5 years',
    jobDescription: jd,
    history,
    lastAnswer: history[1].answer,
    profile,
    ctx,
  })
  const lower = q3.text.toLowerCase()
  assert.ok(
    lower.includes('kafka') || lower.includes('redis') || lower.includes('node'),
    `expected role skill theory question, got: ${q3.text}`,
  )
})

test('evaluateResumeAgainstJd hybrid path returns breakdown without LLM', async () => {
  const out = await evaluateResumeAgainstJd({
    resumeText:
      'alex@mail.com github.com/alex React TypeScript engineer, 10,000 users, 35% faster APIs.',
    jobDescription: 'Need React, TypeScript, Docker for cloud APIs.',
    requiredSkills: ['React', 'TypeScript', 'Docker'],
    skipLlm: true,
  })
  assert.ok(typeof out.atsScore === 'number')
  assert.ok(out.atsBreakdown)
  assert.ok(out.atsBreakdown.skillsAndKeywords >= 0)
})

test('analyzeInterviewSkillMatch uses hybrid ATS score', () => {
  const analysis = analyzeInterviewSkillMatch({
    jobDescription: 'React TypeScript Node.js required.',
    requiredSkills: ['React', 'TypeScript'],
    profile: { resumeText: 'Built with React and TypeScript for 3 years.' },
    ctx: { resumeSnippet: 'React TypeScript' },
  })
  assert.ok(analysis.atsScore >= 40)
  assert.ok(analysis.atsBreakdown)
})
