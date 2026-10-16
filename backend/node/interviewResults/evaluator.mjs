import { callLlmApi, analyzeAnswer } from '../interviewAgent.mjs'
import { parseEvaluation, heuristicEvaluation } from './logic.mjs'
import * as defaultRepo from './repository.mjs'

/** @type {Map<string, Set<Promise<unknown>>>} */
const inflight = new Map()

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const EVAL_SYSTEM = `You are Ava, a strict but fair technical interviewer. Score ONE interview answer.
Return ONLY minified JSON: {"score":0-100,"relevance":0-10,"accuracy":0-10,"clarity":0-10,"depth":0-10,"feedback":"one sentence"}
Scoring: relevance to the question, technical accuracy, clarity of communication, depth/concrete examples.
An empty, off-topic, or one-line answer scores below 25. Do not reward length alone.`

/** @param {{ pair: object, ctx: object, llm?: typeof callLlmApi, timeoutMs?: number }} opts */
export async function evaluatePair({ pair, ctx, llm = callLlmApi, timeoutMs = 8000 }) {
  if (pair.skipped) {
    return {
      status: 'skipped',
      score: 0,
      criteria: { relevance: 0, accuracy: 0, clarity: 0, depth: 0 },
      feedback: 'Question skipped.',
      source: 'rule',
      model: null,
      evaluatedAt: new Date().toISOString(),
    }
  }
  const question = {
    text: pair.question?.text || '',
    category: pair.question?.category,
    keywords: pair.question?.keywords || [],
  }
  const answer = String(pair.answer || '')
  try {
    const llmPromise = llm({
      system: EVAL_SYSTEM,
      user: JSON.stringify({
        role: ctx.role,
        level: ctx.level,
        question: question.text,
        category: question.category,
        candidateSkills: (ctx.skills || []).slice(0, 12),
        answer,
      }),
      temperature: 0.1,
      tier: 'fast',
      maxTokens: 300,
    })
    const result = await Promise.race([llmPromise, sleep(timeoutMs).then(() => null)])
    if (result?.text) {
      const parsed = parseEvaluation(result.text)
      if (parsed) {
        return {
          ...parsed,
          model: result.model || null,
          evaluatedAt: new Date().toISOString(),
        }
      }
    }
  } catch {
    // fall through to heuristic
  }
  const safeCtx = {
    skills: ctx.skills || [],
    jobs: ctx.jobs || [],
    resumeSnippet: ctx.resumeSnippet || '',
  }
  const analysis = analyzeAnswer(question, answer, safeCtx)
  return {
    ...heuristicEvaluation(analysis),
    model: null,
    evaluatedAt: new Date().toISOString(),
  }
}

/** @param {{ pool: import('pg').Pool, sessionId: string, pair: object, ctx: object, llm?: typeof callLlmApi, repo?: typeof defaultRepo }} opts */
export function evaluateInBackground({ pool, sessionId, pair, ctx, llm = callLlmApi, repo = defaultRepo }) {
  const promise = evaluatePair({ pair, ctx, llm })
    .then((ev) =>
      repo.saveEvaluation(pool, sessionId, pair.questionIndex, {
        ...ev,
        answer: pair.answer,
      }),
    )
    .catch((err) => {
      console.warn('[interview-eval]', sessionId, pair.questionIndex, err.message)
    })
    .finally(() => {
      const set = inflight.get(sessionId)
      if (set) {
        set.delete(promise)
        if (set.size === 0) inflight.delete(sessionId)
      }
    })
  if (!inflight.has(sessionId)) inflight.set(sessionId, new Set())
  inflight.get(sessionId).add(promise)
}

export async function waitForEvaluations(sessionId, timeoutMs = 15000) {
  const set = inflight.get(sessionId)
  if (!set || set.size === 0) return
  await Promise.race([Promise.allSettled([...set]), sleep(timeoutMs)])
}
