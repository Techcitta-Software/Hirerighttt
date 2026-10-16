export const MAX_ANSWER_CHARS = 8000
export const MAX_RESUME_TEXT_CHARS = 20000

function clampInt(n, min, max) {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return min
  return Math.min(max, Math.max(min, v))
}

function uniqueSkills(arr) {
  const seen = new Set()
  const out = []
  for (const raw of arr || []) {
    const s = String(raw || '').trim()
    if (!s) continue
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
    if (out.length >= 60) break
  }
  return out
}

function pendingEvaluation() {
  return {
    status: 'pending',
    score: null,
    criteria: { relevance: null, accuracy: null, clarity: null, depth: null },
    feedback: '',
    source: null,
    model: null,
    evaluatedAt: null,
  }
}

/** @param {{ questionIndex: number, question: object, answer: string, skipped: boolean, answeredAt?: string }} opts */
export function buildQaPair({ questionIndex, question, answer, skipped, answeredAt = new Date().toISOString() }) {
  const q = {
    text: String(question?.text || '').slice(0, 2000),
    category: String(question?.category || ''),
    topic: question?.topic ? String(question.topic) : undefined,
    focus: question?.focus ? String(question.focus) : undefined,
  }
  if (skipped) {
    return {
      questionIndex,
      question: q,
      answer: '',
      skipped: true,
      answeredAt,
      evaluation: {
        status: 'skipped',
        score: 0,
        criteria: { relevance: 0, accuracy: 0, clarity: 0, depth: 0 },
        feedback: 'Question skipped.',
        source: 'rule',
        model: null,
        evaluatedAt: answeredAt,
      },
    }
  }
  return {
    questionIndex,
    question: q,
    answer: String(answer || '').slice(0, MAX_ANSWER_CHARS),
    skipped: false,
    answeredAt,
    evaluation: pendingEvaluation(),
  }
}

/** @param {unknown} body */
export function validateAnswerPayload(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Invalid request body.' }
  }
  const b = /** @type {Record<string, unknown>} */ (body)
  const sessionId = String(b.sessionId || '').trim()
  if (!sessionId || sessionId.length > 64) {
    return { ok: false, error: 'sessionId required.' }
  }
  const questionIndex = Number(b.questionIndex)
  if (!Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex > 49) {
    return { ok: false, error: 'questionIndex must be an integer 0–49.' }
  }
  const question = b.question
  if (!question || typeof question !== 'object') {
    return { ok: false, error: 'question object required.' }
  }
  const q = /** @type {Record<string, unknown>} */ (question)
  const text = String(q.text || '').trim()
  if (!text || text.length > 2000) {
    return { ok: false, error: 'question.text required (max 2000 chars).' }
  }
  let answer = String(b.answer || '').trim()
  if (answer.length > MAX_ANSWER_CHARS) answer = answer.slice(0, MAX_ANSWER_CHARS)
  const skipped =
    Boolean(b.skipped) ||
    answer === '' ||
    answer.startsWith('(Answer skipped')
  if (skipped) answer = ''
  return {
    ok: true,
    value: {
      sessionId,
      questionIndex,
      question: {
        text,
        category: String(q.category || ''),
        topic: q.topic ? String(q.topic) : undefined,
        focus: q.focus ? String(q.focus) : undefined,
      },
      answer,
      skipped,
    },
  }
}

/** @param {string} rawText */
export function parseEvaluation(rawText) {
  const text = String(rawText || '')
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  let parsed
  try {
    parsed = JSON.parse(match[0])
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const criteria = {
    relevance: clampInt(parsed.relevance, 0, 10),
    accuracy: clampInt(parsed.accuracy, 0, 10),
    clarity: clampInt(parsed.clarity, 0, 10),
    depth: clampInt(parsed.depth, 0, 10),
  }
  let score = parsed.score != null ? clampInt(parsed.score, 0, 100) : null
  if (score == null) {
    score = clampInt((criteria.relevance + criteria.accuracy + criteria.clarity + criteria.depth) / 40 * 100, 0, 100)
  }
  const feedback = String(parsed.feedback || '').slice(0, 400)
  return {
    status: 'scored',
    score,
    criteria,
    feedback,
    source: 'llm',
  }
}

/** @param {{ score?: number, feedback?: string }} analysis */
export function heuristicEvaluation(analysis) {
  const score = clampInt(analysis?.score ?? 0, 0, 100)
  const crit = clampInt(score / 10, 0, 10)
  return {
    status: 'fallback',
    score,
    criteria: { relevance: crit, accuracy: crit, clarity: crit, depth: crit },
    feedback: String(analysis?.feedback || '').slice(0, 400),
    source: 'heuristic',
  }
}

/** @param {object[]} qaPairs @param {object} pair */
export function mergeQaPair(qaPairs, pair) {
  const list = Array.isArray(qaPairs) ? [...qaPairs] : []
  const idx = list.findIndex((p) => p.questionIndex === pair.questionIndex)
  if (idx >= 0) {
    const existing = list[idx]
    const sameAnswer = String(existing.answer || '') === String(pair.answer || '')
    const keepEval =
      sameAnswer &&
      existing.evaluation &&
      ['scored', 'fallback', 'skipped'].includes(existing.evaluation.status)
    list[idx] = keepEval ? { ...pair, evaluation: existing.evaluation } : pair
  } else {
    list.push(pair)
  }
  list.sort((a, b) => a.questionIndex - b.questionIndex)
  return list
}

/** @param {object[]} qaPairs @param {number} questionIndex @param {object} evaluation */
export function applyEvaluation(qaPairs, questionIndex, evaluation) {
  const list = Array.isArray(qaPairs) ? [...qaPairs] : []
  const idx = list.findIndex((p) => p.questionIndex === questionIndex)
  if (idx < 0) return list
  list[idx] = {
    ...list[idx],
    evaluation: {
      ...list[idx].evaluation,
      ...evaluation,
    },
  }
  return list
}

/** @param {object[]} qaPairs */
export function computeFinalScore(qaPairs) {
  const list = Array.isArray(qaPairs) ? qaPairs : []
  let sum = 0
  let count = 0
  let scoredCount = 0
  for (const p of list) {
    const st = p.evaluation?.status
    if (st === 'scored' || st === 'fallback') scoredCount++
    if (st === 'scored' || st === 'fallback' || st === 'skipped') {
      count++
      sum += st === 'skipped' ? 0 : clampInt(p.evaluation?.score ?? 0, 0, 100)
    }
  }
  return {
    finalScore: count > 0 ? Math.round(sum / count) : null,
    scoredCount,
    answerCount: list.length,
  }
}

/** @param {object} user @param {Record<string, unknown>|null} profile */
export function candidateRowFromUserAndProfile(user, profile) {
  const p = profile && typeof profile === 'object' ? profile : {}
  const email = String(user.email || '').toLowerCase()
  const local = email.includes('@') ? email.split('@')[0] : email
  const username = String(user.username || user.name || local).trim().slice(0, 80) || local
  const fullName = String(p.fullName || p.name || user.name || '').trim()
  const resumeText = String(p.resumeText || '').slice(0, MAX_RESUME_TEXT_CHARS)
  return {
    id: user.id,
    email,
    username,
    full_name: fullName || user.name || username,
    phone: user.phone || null,
    password_hash: user.passwordHash,
    job_title: String(p.currentRole || ''),
    total_experience: String(p.totalExperience || ''),
    location: String(p.currentLocation || ''),
    resume_skills: uniqueSkills(Array.isArray(p.skills) ? p.skills : []),
    resume_name: p.resumeName ? String(p.resumeName) : null,
    resume_text: resumeText,
    experience_summary: String(p.experienceSummary || ''),
    work_experiences: Array.isArray(p.workExperiences) ? p.workExperiences : [],
    certifications: Array.isArray(p.certifications) ? p.certifications : [],
    preferred_roles: uniqueSkills(Array.isArray(p.preferredRoles) ? p.preferredRoles : []),
  }
}
