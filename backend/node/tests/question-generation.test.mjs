import assert from 'node:assert/strict'
import test from 'node:test'
import {
  generateAdaptiveQuestion,
  generateAdaptiveQuestionLocal,
  summarizeProfile,
  INTERVIEW_TURN_COUNT,
} from '../interviewAgent.mjs'

const CATEGORIES = ['Communication', 'Technical', 'Problem Solving', 'Experience']

function sampleCtx() {
  return summarizeProfile(
    {
      fullName: 'Karthik Rao',
      skills: ['React', 'Node.js'],
      workExperiences: [
        {
          jobTitle: 'Software Engineer',
          company: 'Acme',
          description: 'Built billing APIs',
        },
      ],
      achievements: ['Reduced latency 30%'],
      resumeText:
        'Karthik Rao\nSoftware Engineer at Acme. Built billing APIs with React and Node.js.',
    },
    'Karthik Rao',
  )
}

test('local question generation follows the spec without a Gemini key', async () => {
  const prev = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    LLM_API_KEY: process.env.LLM_API_KEY,
  }
  delete process.env.GEMINI_API_KEY
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENROUTER_API_KEY
  delete process.env.LLM_API_KEY

  const ctx = sampleCtx()
  const first = await generateAdaptiveQuestion({
    ctx,
    role: 'Full Stack Engineer',
    level: '1–3 years',
    history: [],
    lastAnswer: '',
  })
  assert.ok(first.text.length >= 24)
  assert.ok(CATEGORIES.includes(first.category))
  assert.ok(
    String(first.focus || '').startsWith('structured-work') ||
      String(first.focus || '').startsWith('structured-theory'),
    `expected structured turn focus, got: ${first.focus}`,
  )
  assert.match(first.text, /Karthik/)
  assert.match(first.text, /responsibilit|contribution|Acme/i)
  assert.doesNotMatch(first.text, /\b(Arjun|there|TechCitta|Initech)\b/i)

  const javaAnswer =
    'I am good at Java and I shipped a billing service with it over two years, including tests.'
  const second = generateAdaptiveQuestionLocal({
    ctx,
    role: 'Full Stack Engineer',
    level: '1–3 years',
    history: [{ question: first, answer: javaAnswer }],
    lastAnswer: javaAnswer,
  })
  assert.match(second.text, /problem|challenge|decision|trade-off/i)
  assert.notEqual(second.text.slice(0, 40), first.text.slice(0, 40))
  assert.ok(second.text.length >= 24)

  const thin = generateAdaptiveQuestionLocal({
    ctx,
    role: 'Full Stack Engineer',
    level: '1–3 years',
    history: [{ question: first, answer: 'ok' }],
    lastAnswer: 'ok',
  })
  assert.match(thin.text, /problem|challenge|decision|trade-off/i)
  assert.doesNotMatch(thin.text, /TechCitta|Initech/)
  assert.notEqual(thin.text.slice(0, 40), first.text.slice(0, 40))

  const anon = generateAdaptiveQuestionLocal({
    ctx: summarizeProfile({ skills: ['Python'], resumeText: 'Student project using Python.' }, ''),
    role: 'Backend Developer',
    level: 'Fresher',
    history: [],
    lastAnswer: '',
  })
  assert.match(anon.text, /Python|Backend|concrete|describe/i)
  assert.equal(anon.category, 'Technical')
  assert.doesNotMatch(anon.text, /\bthere\b|\bArjun\b|\bCandidate\b/)

  const workHistory = [
    { question: first, answer: javaAnswer },
    {
      question: second,
      answer: 'We split the monolith and added caching; latency dropped 30%.',
    },
  ]
  const third = generateAdaptiveQuestionLocal({
    ctx,
    role: 'Full Stack Engineer',
    level: '1–3 years',
    history: workHistory,
    lastAnswer: workHistory[1].answer,
  })
  assert.match(third.text, /Node|React/i)
  assert.ok(String(third.focus || '').startsWith('structured-theory'))

  const history = []
  const prefixes = new Set()
  for (let turn = 0; turn < INTERVIEW_TURN_COUNT; turn++) {
    const q = generateAdaptiveQuestionLocal({
      ctx,
      role: 'Full Stack Engineer',
      level: '5+ years',
      history,
      lastAnswer: '',
    })
    assert.ok(q.text.length >= 24)
    assert.ok(CATEGORIES.includes(q.category))
    const prefix = q.text.slice(0, 40)
    assert.equal(prefixes.has(prefix), false)
    prefixes.add(prefix)
    history.push({ question: q, answer: '' })
  }

  for (const [key, value] of Object.entries(prev)) {
    if (value == null) delete process.env[key]
    else process.env[key] = value
  }
})
