import { loadEnv } from '../loadEnv.mjs'
import { callLlmApi, llmConfigured, generateAdaptiveQuestion } from '../interviewAgent.mjs'

loadEnv()
console.log('llmConfigured:', llmConfigured())
console.log('PRIMARY:', process.env.PRIMARY_MODEL, 'BASE:', process.env.OPENAI_BASE_URL)

const t0 = Date.now()
const r = await callLlmApi({
  system: 'Return JSON: {"question":{"text":"Ping question?","category":"Communication","keywords":["ping"],"hint":"x","topic":"Ping"}}',
  user: 'one question',
  temperature: 0.2,
})
console.log('callLlmApi:', Date.now() - t0, 'ms', r ? `OK ${r.model}` : 'NULL')
if (r) console.log('snippet:', r.text.slice(0, 180))

const t1 = Date.now()
const q = await generateAdaptiveQuestion({
  role: 'Full Stack Engineer',
  level: '1–3 years',
  profile: { skills: ['React'], resumeText: 'Senior dev at Acme Corp built React dashboards.' },
  history: [],
  lastAnswer: '',
})
console.log('generateAdaptiveQuestion:', Date.now() - t1, 'ms', 'focus:', q.focus)
console.log('text:', q.text.slice(0, 120))
