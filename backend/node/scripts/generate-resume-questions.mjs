/**
 * Generate interview questions from a resume PDF (prod batch + optional deferred turns).
 * Usage:
 *   node scripts/generate-resume-questions.mjs <resume.pdf> [--sets 3] [--role "Senior AI Developer"] [--level "2–5 years"]
 */
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const envPath = resolve(root, '.env')
try {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {
  /* optional */
}

const argv = process.argv.slice(2)
const pdfPath = argv.find((a) => !a.startsWith('--'))
const setsArg = argv.find((a) => a.startsWith('--sets='))?.split('=')[1] || argv[argv.indexOf('--sets') + 1]
const setCount = Math.min(5, Math.max(1, Number(setsArg) || 1))
const roleArg =
  argv.find((a) => a.startsWith('--role='))?.slice(7) ||
  (argv.includes('--role') ? argv[argv.indexOf('--role') + 1] : null)
const levelArg =
  argv.find((a) => a.startsWith('--level='))?.slice(8) ||
  (argv.includes('--level') ? argv[argv.indexOf('--level') + 1] : null)

if (!pdfPath) {
  console.error('Usage: node scripts/generate-resume-questions.mjs <resume.pdf> [--sets 3] [--role TITLE] [--level "2–5 years"]')
  process.exit(1)
}

const { execSync } = await import('node:child_process')
let resumeText = ''
try {
  resumeText = execSync(
    `python -c "import pypdf; r=pypdf.PdfReader(r'${pdfPath.replace(/'/g, "''")}'); print(''.join(p.extract_text() or '' for p in r.pages))"`,
    { encoding: 'utf8', cwd: root },
  )
} catch {
  console.error('Could not extract PDF text (install pypdf).')
  process.exit(1)
}

const firstLine = resumeText.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || 'Candidate'
const name = firstLine.replace(/\s+(Senior|Junior|AI|Developer|Engineer).*$/i, '').trim() || firstLine
const role =
  roleArg ||
  (resumeText.match(/AI\/ML Engineer/i)
    ? 'AI/ML Engineer'
    : resumeText.match(/Senior AI Developer/i)
      ? 'Senior AI Developer'
      : 'AI Engineer')
const level =
  levelArg ||
  (/\b8\+?\s*years?/i.test(resumeText)
    ? '5+ years'
    : /\b2\.5\s*Years?\b/i.test(resumeText)
      ? '2–5 years'
      : '1–3 years')

function recentEmployerFromResume(text) {
  const block = text.split(/WORK HISTORY/i)[1] || text
  const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  for (let i = 0; i < lines.length; i++) {
    if (/^\d{2}\/\d{4}\s*-\s*/.test(lines[i]) && lines[i + 1] && lines[i + 1].length < 80) {
      return { company: lines[i + 1], jobTitle: role }
    }
  }
  const nokia = /Nokia/i.test(text) ? 'Nokia' : null
  return { company: nokia || 'Most recent employer (see resume)', jobTitle: role }
}

const recentJob = recentEmployerFromResume(resumeText)

const profile = {
  fullName: name,
  name,
  currentRole: role,
  totalExperience: level,
  resumeText,
  skills: [],
  workExperiences: [
    {
      jobTitle: recentJob.jobTitle,
      company: recentJob.company,
      description: resumeText.slice(0, 600),
    },
  ],
  certifications: [],
}

const {
  summarizeProfile,
  generateAdaptiveQuestionBatch,
  generateAdaptiveQuestion,
} = await import('../interviewAgent.mjs')
const { getSkillsForRole } = await import('../roleSkillStore.mjs')
const {
  structuredPlanSummary,
  resolveExactInterviewRole,
  experiencedFallbackTurnNumber,
  PENDING_FALLBACK_FOCUS,
  PENDING_CLOSING_FOCUS,
  experiencedClosingTurnNumber,
} = await import('../interviewQuestionPlan.mjs')

async function generateWithRetry(label, fn) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const retryable = err?.code === 'LLM_QUESTION_FAILED' && attempt < 7
      if (!retryable) throw err
      const waitMs = 8000 * (attempt + 1)
      console.warn(`${label} — retry ${attempt + 2}/8 in ${waitMs / 1000}s…`)
      await new Promise((r) => setTimeout(r, waitMs))
    }
  }
}

function printBatchQuestions(questions, label) {
  console.log(`\n${'='.repeat(72)}\n${label}\n${'='.repeat(72)}\n`)
  questions.forEach((q, i) => {
    const turn = i + 1
    if (q?.focus === PENDING_FALLBACK_FOCUS) {
      console.log(`Q${turn} [deferred — fallback API after prior answers]\n`)
      return
    }
    if (q?.focus === PENDING_CLOSING_FOCUS) {
      console.log(`Q${turn} [deferred — closing API after fallback]\n`)
      return
    }
    console.log(`Q${turn} [${q.category}] ${q.topic || ''}`)
    console.log(`  ${q.text}\n`)
  })
}

const ctx = summarizeProfile(profile, profile.fullName)
const exactRole = resolveExactInterviewRole(profile, role)
const fromStore = getSkillsForRole(exactRole)
const roleSkills =
  fromStore.length >= 3
    ? fromStore.slice(0, 3)
    : ['Python', 'Retrieval-Augmented Generation (RAG)', 'LangChain']

console.log('\n--- Candidate ---')
console.log(`Name: ${name} | Role: ${exactRole} | Level: ${level} | Sets: ${setCount}`)

const batches = []

for (let s = 1; s <= setCount; s++) {
  const varietySeed = randomBytes(8).toString('hex')
  const planSummary = structuredPlanSummary(exactRole, ctx, profile, level, roleSkills, null, varietySeed)
  if (s === 1) {
    console.log('\n--- Interview plan (same structure each set; wording varies by varietySeed) ---')
    console.log(`Turns: ${planSummary.totalTurns} | Fresher: ${planSummary.fresher}`)
    planSummary.turnPlan.forEach((line) => console.log(' ', line))
    console.log(`Skills for theory slots: ${(planSummary.recommendedSkills || []).join(', ')}`)
  }
  console.log(`\n[Set ${s}/${setCount}] varietySeed=${varietySeed}`)

  let batch
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      batch = await generateAdaptiveQuestionBatch({
        ctx,
        profile,
        role,
        level,
        roleSkills,
        planSummary,
        totalTurns: planSummary.totalTurns,
        varietySeed,
      })
      break
    } catch (err) {
      const retryable = err?.code === 'LLM_QUESTION_FAILED' && attempt < 7
      if (!retryable) throw err
      const waitMs = 12_000 * (attempt + 1)
      console.warn(`[Set ${s}] Gemini busy — retry ${attempt + 2}/8 in ${waitMs / 1000}s…`)
      await new Promise((r) => setTimeout(r, waitMs))
    }
  }
  batches.push({ varietySeed, questions: batch.questions, planSummary, batch })
  printBatchQuestions(batch.questions, `SET ${s} — batch questions (one API call per set)`)
}

if (setCount > 1) {
  console.log('\n--- Quick compare (Q2 theory text fingerprints) ---')
  batches.forEach((b, i) => {
    const q2 = b.questions[1]?.text?.slice(0, 120) || '(missing)'
    console.log(`Set ${i + 1}: ${q2}…`)
  })
}

if (setCount === 1 && batches[0]?.batch?.fallbackTurn && !batches[0].planSummary.fresher) {
  const varietySeed = batches[0].varietySeed
  const planSummary = batches[0].planSummary
  const batch = batches[0].batch
  const fallbackTurn = batch.fallbackTurn ?? experiencedFallbackTurnNumber()
  const mockHistory = batch.questions
    .map((q, i) => ({ question: q, answer: `[Sample answer for turn ${i + 1}]` }))
    .slice(0, fallbackTurn - 1)
    .filter((h) => h.question?.text?.length >= 24)
  const sampleAnswers = [
    `At ${recentJob.company} I build Python FastAPI services, RAG pipelines with Gemini, document chunking and embeddings, PostgreSQL, and AWS event-driven ingestion with S3, EventBridge, SQS, Lambda, and Bedrock Knowledge Bases.`,
    'Supervised learning uses labeled data for prediction; unsupervised finds structure without labels — I pick supervised when we have outcome labels for evaluation.',
    'Generator expressions yield items lazily so memory stays bounded; list comprehensions materialize the full list — I use generators for large document batches.',
    'Scaling puts features on comparable ranges so gradient-based models and distance metrics are not dominated by one feature magnitude.',
    'In our CrewAI blog project I wired transcript ingestion, agent roles for research and drafting, and Gemini calls behind FastAPI with Streamlit for demos.',
    'I tightened prompts with explicit output schema, added regression checks on extracted fields, and logged failed generations in LangSmith-style traces for debugging.',
  ]
  mockHistory.forEach((h, idx) => {
    if (sampleAnswers[idx]) h.answer = sampleAnswers[idx]
  })
  const fallback = await generateWithRetry('Fallback question', () =>
    generateAdaptiveQuestion({
      ctx,
      profile,
      role,
      level,
      roleSkills,
      planSummary,
      totalTurns: planSummary.totalTurns,
      varietySeed,
      history: mockHistory,
      lastAnswer: mockHistory[mockHistory.length - 1]?.answer || '',
    }),
  )
  console.log('--- Fallback (separate API) ---\n')
  console.log(`Q${fallbackTurn}: ${fallback.text}\n`)
  const closingTurn = batch.closingTurn ?? experiencedClosingTurnNumber()
  const historyWithFallback = [
    ...mockHistory,
    {
      question: fallback,
      answer: 'I expose streaming endpoints and structured partial JSON so the UI stays responsive while agents run.',
    },
  ]
  const closing = await generateWithRetry('Closing question', () =>
    generateAdaptiveQuestion({
      ctx,
      profile,
      role,
      level,
      roleSkills,
      planSummary,
      totalTurns: planSummary.totalTurns,
      varietySeed,
      history: historyWithFallback,
      lastAnswer: historyWithFallback[historyWithFallback.length - 1]?.answer || '',
    }),
  )
  console.log('--- Closing (separate API after fallback) ---\n')
  console.log(`Q${closingTurn}: ${closing.text}\n`)
}
