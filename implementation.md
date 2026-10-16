# HIRERIGHTTT — Implementation Spec: Per-Answer Interview Storage + Candidates Table

This document is written for an AI coding agent. Follow it **top to bottom, in order**. Every step lists the exact files, the exact code shape, and how to verify the step before moving on. Do not skip the verification steps.

Features:

1. **Per-answer interview storage + parallel LLM scoring.** Every time a candidate submits an answer, the question/answer pair is written to Neon immediately. In parallel, the LLM evaluates that pair and writes the score back to the same row. A final score is the accumulation (average) of all per-question scores.
2. **Dedicated `candidates` table.** Candidate data from signup (username, email, phone, password hash) plus resume-extracted fields (skills, resume text, experience, …) lives in its own table.

---

## 0. Ground rules for the agent (read first)

| Rule | Why |
|---|---|
| Use the single repo-root `.env`. Never create `backend/node/.env` or `frontend/.env`. | `env/loadEnv.mjs` loads only the root file; extra files override values silently. |
| Never commit `.env` or print secrets in logs/tests. | Keys are live (Neon, Gemini, Groq). |
| **Do NOT add the new tables to `dbCache` / `loadRelational` / `saveRelational` in `backend/node/db/store.mjs`.** Use direct `pool.query(...)` calls in a new repository module. | `saveDb()` full-syncs every table on every save; some tables are DELETE + reinsert. Per-answer writes must be small, atomic, and concurrent-safe. |
| **Do NOT rename or change the existing `interview_results` table** (PK = `email`). | `saveRelational` upserts it from `db.interviews`; the dashboard depends on it. The new table is `candidate_interview_results`. |
| **Do NOT name a column `current_role`.** Use `job_title`. | `CURRENT_ROLE` is a reserved SQL keyword in PostgreSQL; the `CREATE TABLE` fails. |
| **Never store plaintext passwords.** `candidates.password_hash` holds the same scrypt hash as `users.password_hash` (`hashPassword` from `backend/node/authPasswords.mjs`). | Security. |
| All SQL must be idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`). | Schema files are re-applied on every server boot by `applySchema()`. |
| Use parameterized queries only (`$1, $2…`). No string interpolation of user input into SQL. | SQL injection. |
| Match existing style: ESM `.mjs`, JSDoc types, 2-space indent, no semicolons, single quotes. | Consistency with `backend/node`. |
| Keep the interview UX unchanged: storing/scoring must never block the candidate from getting the next question. | Latency. |

Environment facts:

- Node 24 (`node --version` → v24.x), Windows PowerShell dev box. Use `;` not `&&` when chaining in PowerShell 5.
- Backend: `backend/node/index.mjs` (raw `node:http`, single big router of `if (url.pathname === ... && req.method === ...)` blocks).
- DB: Neon Postgres through `pg`, pool in `backend/node/db/store.mjs` (`getPool(databaseUrl)` — currently **not exported**).
- LLM: `callLlmApi({ system, user, temperature, tier, maxTokens })` in `backend/node/interviewAgent.mjs` (Gemini cascade from `backend/node/llmModels.mjs`: `gemini-3.1-flash-lite` → `gemini-3.5-flash-lite` → `gemini-flash-lite-latest`).
- Tests: `node:test`, files in `backend/node/tests/*.test.mjs`, run with `npm --prefix backend/node test`.

---

## 1. Target data model

### 1.1 `candidates` (Feature 2)

One row per job-seeker account. `id` = `users.id` (so "candidate id" everywhere is the user id).

| Column | Type | Source |
|---|---|---|
| `id` | `TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE` | `users.id` |
| `email` | `TEXT NOT NULL UNIQUE` | signup |
| `username` | `TEXT NOT NULL` | signup `body.username` if present, else signup `name` |
| `full_name` | `TEXT NOT NULL DEFAULT ''` | signup `name`, later `profile.fullName` |
| `phone` | `TEXT` | signup `phone` |
| `password_hash` | `TEXT NOT NULL` | `users.password_hash` (scrypt) |
| `job_title` | `TEXT NOT NULL DEFAULT ''` | `profile.currentRole` |
| `total_experience` | `TEXT NOT NULL DEFAULT ''` | `profile.totalExperience` |
| `location` | `TEXT NOT NULL DEFAULT ''` | `profile.currentLocation` |
| `resume_skills` | `TEXT[] NOT NULL DEFAULT '{}'` | `profile.skills` (extracted from resume by `parseResumeFile` / resume parser) |
| `resume_name` | `TEXT` | `profile.resumeName` |
| `resume_text` | `TEXT NOT NULL DEFAULT ''` | `profile.resumeText` (truncate to 20 000 chars) |
| `experience_summary` | `TEXT NOT NULL DEFAULT ''` | `profile.experienceSummary` |
| `work_experiences` | `JSONB NOT NULL DEFAULT '[]'` | `profile.workExperiences` |
| `certifications` | `JSONB NOT NULL DEFAULT '[]'` | `profile.certifications` |
| `preferred_roles` | `TEXT[] NOT NULL DEFAULT '{}'` | `profile.preferredRoles` |
| `created_at` / `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` | — |

### 1.2 `candidate_interview_results` (Feature 1 — the "interview results schema")

One row per interview session.

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | = interview `sessionId` from `/api/interview/start` |
| `candidate_id` | `TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE` | = `users.id` |
| `candidate_name` | `TEXT NOT NULL DEFAULT ''` | snapshot at interview start |
| `candidate_email` | `TEXT NOT NULL` | |
| `role` / `level` | `TEXT NOT NULL DEFAULT ''` | interview target |
| `qa_pairs` | `JSONB NOT NULL DEFAULT '[]'` | array of QA objects (shape below) |
| `final_score` | `INTEGER` | 0–100, NULL until ≥1 pair scored |
| `scored_count` | `INTEGER NOT NULL DEFAULT 0` | pairs with evaluation.status in (`scored`,`fallback`) |
| `answer_count` | `INTEGER NOT NULL DEFAULT 0` | `jsonb_array_length(qa_pairs)` |
| `status` | `TEXT NOT NULL DEFAULT 'in_progress'` | `in_progress` \| `completed` \| `abandoned` |
| `started_at`, `completed_at`, `updated_at` | `TIMESTAMPTZ` | |

**`qa_pairs` element shape (exact):**

```json
{
  "questionIndex": 0,
  "question": { "text": "…", "category": "Technical", "topic": "React", "focus": "…" },
  "answer": "candidate's transcribed answer",
  "skipped": false,
  "answeredAt": "2026-10-15T10:00:00.000Z",
  "evaluation": {
    "status": "pending",
    "score": null,
    "criteria": { "relevance": null, "accuracy": null, "clarity": null, "depth": null },
    "feedback": "",
    "source": null,
    "model": null,
    "evaluatedAt": null
  }
}
```

- `evaluation.status`: `pending` → `scored` (LLM) | `fallback` (heuristic used because LLM failed) | `skipped` (answer skipped, score 0).
- `evaluation.score`: integer 0–100. `criteria.*`: integers 0–10.
- `questionIndex` is unique inside the array (idempotency key — re-posting the same index **replaces** the element, never duplicates).
- Array is kept sorted by `questionIndex`.

**Final score rule (exact):** `final_score = round(sum(score) / count)` over all elements whose `evaluation.status` ∈ {`scored`, `fallback`, `skipped`} (skipped counts as 0). Elements still `pending` are excluded. If count = 0 → `NULL`.

---

## 2. Step-by-step implementation

### Step 1 — SQL schema file

Create `backend/node/db/schema-candidate-interviews.sql`:

```sql
-- Candidates (Feature 2) and per-answer interview results (Feature 1).
CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  phone TEXT,
  password_hash TEXT NOT NULL,
  job_title TEXT NOT NULL DEFAULT '',
  total_experience TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  resume_skills TEXT[] NOT NULL DEFAULT '{}',
  resume_name TEXT,
  resume_text TEXT NOT NULL DEFAULT '',
  experience_summary TEXT NOT NULL DEFAULT '',
  work_experiences JSONB NOT NULL DEFAULT '[]'::jsonb,
  certifications JSONB NOT NULL DEFAULT '[]'::jsonb,
  preferred_roles TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_candidates_resume_skills ON candidates USING GIN (resume_skills);

CREATE TABLE IF NOT EXISTS candidate_interview_results (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidate_name TEXT NOT NULL DEFAULT '',
  candidate_email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT '',
  qa_pairs JSONB NOT NULL DEFAULT '[]'::jsonb,
  final_score INTEGER CHECK (final_score IS NULL OR (final_score BETWEEN 0 AND 100)),
  scored_count INTEGER NOT NULL DEFAULT 0,
  answer_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cir_candidate ON candidate_interview_results (candidate_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cir_status ON candidate_interview_results (status);
```

Edit `backend/node/db/applySchema.mjs`:

- Append `'schema-candidate-interviews.sql'` to `SCHEMA_FILES` (**last**, because it references `users` from `schema.sql`).
- Append `'candidates'` and `'candidate_interview_results'` to `EXPECTED_TABLES`.

**Verify:** `npm run db:init` then `npm run db:verify` (repo root) — both exit 0 and verify lists the two new tables.

### Step 2 — Export the pool from the store

In `backend/node/db/store.mjs` add (do not change `getPool` itself):

```js
/** Pool with schema applied — for modules that write rows directly (not via dbCache). */
export async function getReadyPool(databaseUrl) {
  await ensurePgSchema(databaseUrl)
  return getPool(databaseUrl)
}
```

### Step 3 — Pure logic module (no I/O, fully unit-testable)

Create `backend/node/interviewResults/logic.mjs`. It must export exactly these pure functions:

```js
export const MAX_ANSWER_CHARS = 8000
export const MAX_RESUME_TEXT_CHARS = 20000

/** @returns {object} a qa_pairs element with evaluation.status 'pending' (or 'skipped' with score 0) */
export function buildQaPair({ questionIndex, question, answer, skipped, answeredAt = new Date().toISOString() })

/** Validates POST /api/interview/answer body. Returns { ok: true, value } or { ok: false, error } */
export function validateAnswerPayload(body)

/**
 * Parse raw LLM text into a normalized evaluation.
 * Accepts text with surrounding prose / ```json fences; extracts the first {...} block.
 * Clamps score to 0..100 and criteria to 0..10 (integers). Returns null when unparseable.
 */
export function parseEvaluation(rawText)

/** Heuristic fallback evaluation from analyzeAnswer() output ({ score, feedback, ... }). source = 'heuristic', status = 'fallback' */
export function heuristicEvaluation(analysis)

/** Upsert by questionIndex, keep sorted. Returns a NEW array (no mutation). */
export function mergeQaPair(qaPairs, pair)

/** Apply evaluation to element with questionIndex. Returns NEW array. No-op if index missing. */
export function applyEvaluation(qaPairs, questionIndex, evaluation)

/** Final score rule from section 1.2. Returns { finalScore: number|null, scoredCount: number, answerCount: number } */
export function computeFinalScore(qaPairs)

/** Map users row + SavedProfile -> candidates row values (section 1.1). Handles missing profile. */
export function candidateRowFromUserAndProfile(user, profile)
```

Implementation details:

- `validateAnswerPayload`: require `sessionId` (non-empty string ≤ 64), `questionIndex` (integer 0–49), `question.text` (non-empty string ≤ 2000). `answer` string trimmed and truncated to `MAX_ANSWER_CHARS`. `skipped = Boolean(body.skipped) || answer === '' || answer.startsWith('(Answer skipped')`. When skipped, store `answer: ''`.
- `parseEvaluation`: expected LLM JSON `{"score":0-100,"relevance":0-10,"accuracy":0-10,"clarity":0-10,"depth":0-10,"feedback":"one sentence"}`. If `score` missing but criteria present → `score = round(sum(criteria) / 40 * 100)`. `feedback` truncated to 400 chars. Return `{ status: 'scored', score, criteria, feedback, source: 'llm' }`.
- `heuristicEvaluation(analysis)`: `score = clamp(round(analysis.score), 0, 100)`, criteria derived as `round(score/10)` each, `feedback = analysis.feedback || ''`.
- `candidateRowFromUserAndProfile`: arrays de-duplicated (case-insensitive), skills trimmed, max 60 skills; `username = user.username || user.name || email local-part`; `full_name = profile.fullName || profile.name || user.name`.

### Step 4 — Repository module (DB I/O)

Create `backend/node/interviewResults/repository.mjs`. All functions take `pool` (a `pg.Pool`) as the first argument — this makes them testable against an isolated schema.

```js
export async function upsertCandidate(pool, row)               // INSERT … ON CONFLICT (id) DO UPDATE SET …, updated_at = NOW()
export async function updateCandidatePasswordHash(pool, userId, passwordHash)
export async function getCandidate(pool, userId)               // omit password_hash from the returned object

export async function createInterviewResult(pool, { id, candidateId, candidateName, candidateEmail, role, level })
  // INSERT … ON CONFLICT (id) DO NOTHING

export async function recordQaPair(pool, sessionId, candidateId, pair)
export async function saveEvaluation(pool, sessionId, questionIndex, evaluation)
export async function finalizeInterviewResult(pool, sessionId, { status = 'completed' } = {})
export async function getInterviewResult(pool, sessionId, candidateId)   // null if not owned
export async function listInterviewResults(pool, candidateId, { limit = 20 } = {})
```

**Concurrency rule (mandatory):** `recordQaPair`, `saveEvaluation`, and `finalizeInterviewResult` each run in a transaction that locks the row:

```js
const client = await pool.connect()
try {
  await client.query('BEGIN')
  const { rows } = await client.query(
    'SELECT qa_pairs, candidate_id, status FROM candidate_interview_results WHERE id = $1 FOR UPDATE',
    [sessionId],
  )
  // … ownership check, then compute next array with mergeQaPair/applyEvaluation and computeFinalScore …
  await client.query(
    `UPDATE candidate_interview_results
       SET qa_pairs = $2::jsonb, final_score = $3, scored_count = $4, answer_count = $5, updated_at = NOW()
     WHERE id = $1`,
    [sessionId, JSON.stringify(next), finalScore, scoredCount, answerCount],
  )
  await client.query('COMMIT')
} catch (err) {
  await client.query('ROLLBACK').catch(() => {})
  throw err
} finally {
  client.release()
}
```

Why: evaluation for answer N and the insert for answer N+1 can run at the same time; without `FOR UPDATE` one write overwrites the other's jsonb.

Extra rules:

- `recordQaPair` throws `Object.assign(new Error('Interview result not found'), { status: 404 })` when the row doesn't exist or `candidate_id` ≠ caller; throws status 409 when `status !== 'in_progress'`.
- `recordQaPair` must **preserve** an existing `scored` evaluation if the same `questionIndex` is re-posted with the **identical** answer text (retry-safe); if the answer text changed, reset evaluation to `pending`.
- `saveEvaluation` must ignore the write if the element's current answer differs from the one that was evaluated (pass `answer` in and compare) — prevents a stale evaluation overwriting a newer answer.
- `finalizeInterviewResult` sets `status`, `completed_at = NOW()`, recomputes `final_score`.

### Step 5 — Evaluator service (parallel LLM scoring)

Create `backend/node/interviewResults/evaluator.mjs`:

```js
import { callLlmApi, analyzeAnswer } from '../interviewAgent.mjs'
import { parseEvaluation, heuristicEvaluation } from './logic.mjs'

const inflight = new Map() // sessionId -> Set<Promise>

export function evaluateInBackground({ pool, sessionId, pair, ctx, llm = callLlmApi, repo }) { … }
export async function waitForEvaluations(sessionId, timeoutMs = 15000) { … }
export async function evaluatePair({ pair, ctx, llm = callLlmApi }) { … } // returns evaluation object
```

- In `backend/node/interviewAgent.mjs`, change `function analyzeAnswer(` to `export function analyzeAnswer(` (no other changes there). `callLlmApi` is already exported (line ~302; default `tier = 'quality'`, so pass `tier: 'fast'` explicitly).
- `evaluatePair`:
  - If `pair.skipped` → return `{ status: 'skipped', score: 0, criteria: {relevance:0,accuracy:0,clarity:0,depth:0}, feedback: 'Question skipped.', source: 'rule' }` **without** calling the LLM.
  - Otherwise call `llm({ system, user, temperature: 0.1, tier: 'fast', maxTokens: 300 })` with an 8 s timeout (`Promise.race`).
  - System prompt (exact):
    ```
    You are Ava, a strict but fair technical interviewer. Score ONE interview answer.
    Return ONLY minified JSON: {"score":0-100,"relevance":0-10,"accuracy":0-10,"clarity":0-10,"depth":0-10,"feedback":"one sentence"}
    Scoring: relevance to the question, technical accuracy, clarity of communication, depth/concrete examples.
    An empty, off-topic, or one-line answer scores below 25. Do not reward length alone.
    ```
  - User message: `JSON.stringify({ role: ctx.role, level: ctx.level, question: pair.question.text, category: pair.question.category, candidateSkills: ctx.skills?.slice(0, 12), answer: pair.answer })`.
  - Parse with `parseEvaluation`. On null/throw/timeout → `heuristicEvaluation(analyzeAnswer(pair.question, pair.answer, ctx))`.
  - Add `model` (if returned by `callLlmApi`) and `evaluatedAt`.
- `evaluateInBackground`: starts `evaluatePair(...).then(ev => repo.saveEvaluation(pool, sessionId, pair.questionIndex, { ...ev, answer: pair.answer }))`, registers the promise in `inflight`, removes it on settle, **catches and logs** every error (`console.warn('[interview-eval]', sessionId, pair.questionIndex, err.message)`). Never throws, never awaited by the HTTP handler.
- `waitForEvaluations`: `Promise.race([Promise.allSettled([...set]), sleep(timeoutMs)])`.

### Step 6 — Backend HTTP wiring (`backend/node/index.mjs`)

Imports at top:

```js
import { getReadyPool } from './db/store.mjs'
import * as interviewRepo from './interviewResults/repository.mjs'
import { validateAnswerPayload, buildQaPair, candidateRowFromUserAndProfile } from './interviewResults/logic.mjs'
import { evaluateInBackground, waitForEvaluations, evaluatePair } from './interviewResults/evaluator.mjs'
```

(Merge with the existing `./db/store.mjs` import instead of duplicating it.)

#### 6.1 `/api/interview/start` (existing, ~line 1096)

After `db.interviewSessions[sessionId] = session; await saveDb(db)` add:

```js
const account = db.users.find((u) => u.email === email)
if (account) {
  try {
    const pool = await getReadyPool(config.databaseUrl)
    await interviewRepo.createInterviewResult(pool, {
      id: sessionId,
      candidateId: account.id,
      candidateName: ctx?.name || account.name || '',
      candidateEmail: email,
      role, level,
    })
  } catch (err) {
    console.warn('[interview-results] create failed', err.message)
  }
}
```

(Reuse the `account` variable if one already exists in that handler — it does: `accountName: account?.name`.) Failure here must not fail interview start.

#### 6.2 NEW `POST /api/interview/answer`

Place it next to `/api/interview/turn`.

```js
if (url.pathname === '/api/interview/answer' && req.method === 'POST') {
  const email = await requireAuth(req, res)
  if (!email) return
  if (!rateLimit(`ivanswer:${email}`, 120)) return json(res, 429, { error: 'Too many answers.' })
  const body = await readBody(req)
  const parsed = validateAnswerPayload(body)
  if (!parsed.ok) return json(res, 400, { error: parsed.error })
  const db = loadDb()
  const account = db.users.find((u) => u.email === email)
  const session = db.interviewSessions[parsed.value.sessionId]
  if (!account || !session || session.email !== email) {
    return json(res, 404, { error: 'Interview session not found.' })
  }
  const pool = await getReadyPool(config.databaseUrl)
  // Lazily create the row if /start ran before this feature shipped or its insert failed.
  await interviewRepo.createInterviewResult(pool, {
    id: session.id, candidateId: account.id,
    candidateName: session.context?.name || account.name || '',
    candidateEmail: email, role: session.role, level: session.level,
  })
  const pair = buildQaPair(parsed.value)
  try {
    await interviewRepo.recordQaPair(pool, session.id, account.id, pair)
  } catch (err) {
    return json(res, err.status || 500, { error: err.message })
  }
  evaluateInBackground({
    pool, sessionId: session.id, pair,
    ctx: { ...(session.context || {}), role: session.role, level: session.level },
    repo: interviewRepo,
  })
  return json(res, 202, { stored: true, sessionId: session.id, questionIndex: pair.questionIndex, evaluation: 'pending' })
}
```

Response returns **before** the LLM finishes (HTTP 202). That is the "parallel" requirement.

#### 6.3 NEW `POST /api/interview/complete`

Body: `{ sessionId, status?: 'completed' | 'abandoned' }`.

1. `requireAuth`, ownership check identical to 6.2.
2. `await waitForEvaluations(sessionId, 15000)`.
3. Re-score any element still `pending` (server restart lost the in-memory promise): load row, for each pending pair `await evaluatePair(...)` then `saveEvaluation(...)`. Cap at 10 pairs, run with `Promise.allSettled`.
4. `finalizeInterviewResult(pool, sessionId, { status })`.
5. Return `200 { result }` where `result = await getInterviewResult(pool, sessionId, account.id)`.

#### 6.4 Existing `POST /api/interview/score` (~line 1328)

After `await saveDb(db)` and only when `session` exists, add a **non-blocking** finalize:

```js
void (async () => {
  try {
    const pool = await getReadyPool(config.databaseUrl)
    await waitForEvaluations(sessionId, 15000)
    await interviewRepo.finalizeInterviewResult(pool, sessionId, { status: 'completed' })
  } catch (err) {
    console.warn('[interview-results] finalize failed', err.message)
  }
})()
```

Do **not** change the response shape of `/score`.

#### 6.5 NEW read endpoints

- `GET /api/interview/results` → `{ results: [...] }` for the authed candidate (`listInterviewResults`, newest first, no `qa_pairs` answer text truncation needed).
- `GET /api/interview/results/:sessionId` → `{ result }` or 404. Match with `url.pathname.startsWith('/api/interview/results/')` and `decodeURIComponent(url.pathname.split('/').pop())`.
- Employers/admins: `GET /api/interview/results/:sessionId` may also be allowed when the caller's role is `admin`, or `employer` and `session.organizationId` is one of their organizations — implement only if a helper for org membership already exists in `index.mjs` (search `getOrgApplication` / `primary_organization_id`); otherwise candidate-only.

#### 6.6 Feature 2 hooks (candidates table)

Create a small helper in `index.mjs`:

```js
async function syncCandidateRow(db, email) {
  const user = db.users.find((u) => u.email === email)
  if (!user || user.role !== 'jobseeker' || !user.passwordHash) return
  try {
    const pool = await getReadyPool(config.databaseUrl)
    await interviewRepo.upsertCandidate(pool, candidateRowFromUserAndProfile(user, db.profiles[email] || null))
  } catch (err) {
    console.warn('[candidates] sync failed', email, err.message)
  }
}
```

Check the actual user field names before writing: grep `passwordHash` / `password_hash` and `role:` inside the signup handler (~line 783–840) and `db.profiles` usage in `PUT /api/profile` (~line 900–943). Adjust property names to what the code uses — do not guess.

Call it:

| Where | When | How |
|---|---|---|
| `POST /api/auth/signup` | after the user is saved (`await saveDb(db)`), role = jobseeker | `await syncCandidateRow(db, email)` |
| `POST /api/auth/login` | only if the handler re-hashes/upgrades the password | `void syncCandidateRow(db, email)` |
| `PUT /api/profile` | after the profile is saved (next to the existing `upsertCandidateTalent`) | `void syncCandidateRow(db, email)` |
| Any password reset/change endpoint (grep `hashPassword(`) | after update | `void syncCandidateRow(db, email)` |
| Server boot (after `seedDemoUsers`) | one-time backfill | loop over `db.users.filter(u => u.role === 'jobseeker')` and `await syncCandidateRow(db, u.email)`; wrap in try/catch; log count |

Accept an optional `username` in the signup body (string, 2–40 chars, `[A-Za-z0-9._-]`); store it on the user object as `user.username` so `candidateRowFromUserAndProfile` picks it up. If absent, username = name.

`GET /api/candidates/me` (new, auth required) → `{ candidate }` from `getCandidate` (never includes `password_hash`).

### Step 7 — Frontend client

In `frontend/src/lib/interviewAgentClient.ts` add (reuse the existing `apiFetch` + `ensureApiSession` imports in that file):

```ts
export type InterviewAnswerRecord = {
  sessionId: string
  questionIndex: number
  question: Question
  answer: string
  skipped: boolean
}

/** Stores one Q&A pair in Neon; server scores it asynchronously. Never throws. */
export async function recordInterviewAnswer(rec: InterviewAnswerRecord): Promise<boolean> {
  try {
    await ensureApiSession()
    const res = await apiFetch('/api/interview/answer', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: rec.sessionId,
        questionIndex: rec.questionIndex,
        question: { text: rec.question.text, category: rec.question.category, topic: rec.question.topic, focus: rec.question.focus },
        answer: rec.answer,
        skipped: rec.skipped,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function completeInterviewResult(sessionId: string, status: 'completed' | 'abandoned' = 'completed') {
  try {
    await ensureApiSession()
    const res = await apiFetch('/api/interview/complete', {
      method: 'POST',
      body: JSON.stringify({ sessionId, status }),
      keepalive: status === 'abandoned',
    })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}
```

Check `apiFetch`'s signature first (`frontend/src/lib/api.ts` or `apiSession.ts`); if it doesn't forward `keepalive`, pass it through `init`.

### Step 8 — Frontend wiring (`frontend/src/pages/InterviewPage.tsx`)

1. Add a ref near the other refs: `const pendingAnswerWritesRef = useRef<Promise<boolean>[]>([])`.
2. In `submitAnswer(isSkip)`, **immediately after** `const rawAnswer = …` / `answersRef.current = next` (≈ line 862) and **before** the `isEndInterviewCommand` / finish branches, add:

   ```ts
   const sid = sessionIdRef.current
   const questionForRecord = questions[current]
   if (sid && questionForRecord && !isEndInterviewCommand(rawAnswer)) {
     pendingAnswerWritesRef.current.push(
       recordInterviewAnswer({
         sessionId: sid,
         questionIndex: current,
         question: questionForRecord,
         answer: rawAnswer,
         skipped: isSkip || !rawAnswer,
       }),
     )
   }
   ```

   Do **not** `await` it here — the existing `processInterviewTurn` + `fetchNextAdaptiveQuestion` flow must run unchanged and in parallel.

   Placement matters: it must be before the early `finish(next, false); return` branches so the **last** answer is also stored.

3. In `finish(...)`, inside the async block, **before** calling `scoreInterviewRemote(...)`:

   ```ts
   await Promise.allSettled(pendingAnswerWritesRef.current)
   pendingAnswerWritesRef.current = []
   if (sessionIdRef.current) void completeInterviewResult(sessionIdRef.current, banned ? 'abandoned' : 'completed')
   ```

4. In `leaveInterviewToDashboard()` before `navigate('/dashboard')`:

   ```ts
   if (sessionIdRef.current) void completeInterviewResult(sessionIdRef.current, 'abandoned')
   ```

5. Do not change TTS/STT logic, button states, or the Submit Answer behavior.

### Step 9 — Optional UI (only after tests pass)

On the results/scorecard page, if `GET /api/interview/results/:sessionId` returns data, show per-question score badges from `qa_pairs[i].evaluation.score`. Keep the existing scorecard as the source of truth for layout.

---

## 3. Testing instructions (mandatory)

Run every command from the repo root unless stated. All must pass before declaring done.

### 3.1 Static checks

```powershell
npm --prefix frontend run build      # tsc + vite build, must exit 0
npm --prefix frontend run lint       # if the script exists
node --check backend/node/index.mjs
node --check backend/node/interviewResults/logic.mjs
node --check backend/node/interviewResults/repository.mjs
node --check backend/node/interviewResults/evaluator.mjs
```

### 3.2 Unit tests (no DB, no network)

Create `backend/node/tests/interview-results-logic.test.mjs` using `node:test` + `node:assert/strict`. Required cases:

| # | Function | Case | Expected |
|---|---|---|---|
| 1 | `validateAnswerPayload` | missing `sessionId` | `ok: false` |
| 2 | `validateAnswerPayload` | `questionIndex: -1`, `1.5`, `50` | `ok: false` |
| 3 | `validateAnswerPayload` | answer `'(Answer skipped by candidate)'` | `skipped: true`, `answer: ''` |
| 4 | `validateAnswerPayload` | 10 000-char answer | truncated to 8000 |
| 5 | `parseEvaluation` | `` ```json {"score":82,...} ``` `` with prose around | score 82, status `scored` |
| 6 | `parseEvaluation` | `{"score":150,"clarity":-3}` | score 100, clarity 0 |
| 7 | `parseEvaluation` | criteria only (8,8,6,6) | score 70 |
| 8 | `parseEvaluation` | `'not json'` | `null` |
| 9 | `mergeQaPair` | insert index 2 then 0 | sorted `[0,2]` |
| 10 | `mergeQaPair` | re-insert index 0 | length unchanged, answer replaced |
| 11 | `computeFinalScore` | scores 80, 60, pending | `finalScore 70`, `scoredCount 2`, `answerCount 3` |
| 12 | `computeFinalScore` | 90 + skipped(0) | `45` |
| 13 | `computeFinalScore` | all pending / empty | `null` |
| 14 | `candidateRowFromUserAndProfile` | no profile | empty arrays, username = name |
| 15 | `candidateRowFromUserAndProfile` | skills `['React','react',' Node ']` | `['React','Node']` |
| 16 | `candidateRowFromUserAndProfile` | any input | result has `password_hash` = user hash; never a plaintext `password` key |

Create `backend/node/tests/interview-evaluator.test.mjs` with an injected fake `llm`:

- fake returns valid JSON → `source: 'llm'`, `status: 'scored'`.
- fake throws → `status: 'fallback'`, `source: 'heuristic'`, score 0–100.
- fake never resolves → falls back within ~8 s (use a shorter timeout parameter if you expose one, e.g. `timeoutMs` option, to keep the test fast).
- skipped pair → fake **not called** (assert call count 0), score 0.

Run: `npm --prefix backend/node test` — all existing tests plus the new ones pass.

### 3.3 Postgres integration test (local Postgres, isolated schema)

Follow the existing pattern in `backend/node/tests/http-postgres.test.mjs` / `assessment-postgres.test.mjs` exactly:

- Skip unless `ASSESSMENT_TEST_DATABASE_URL` is set **and** points to `localhost`/`127.0.0.1` (never run destructive tests against Neon).
- Create a unique schema (`test_cir_<random>`), set `search_path` via the connection string `options=-c search_path=...` the same way the existing tests do, run `applySchema`, then `DROP SCHEMA … CASCADE` in `after()`.

Create `backend/node/tests/interview-results-postgres.test.mjs`. Call the repository directly with a `pg.Pool` (no HTTP server needed for most cases):

1. Insert a `users` row, `upsertCandidate` → `SELECT` shows `resume_skills` array and `password_hash` starts with the scrypt prefix used by `hashPassword` (check `authPasswords.mjs` for the format).
2. `upsertCandidate` again with new skills → one row, skills updated, `updated_at` advanced.
3. `createInterviewResult` twice with same id → one row.
4. `recordQaPair` indexes 0,1,2 **concurrently** (`Promise.all`) → `jsonb_array_length(qa_pairs) = 3`, all `pending`.
5. `saveEvaluation` for 0 and 1 concurrently with `recordQaPair` index 3 → nothing lost (4 pairs, 2 scored).
6. `final_score` equals the average of the 2 scored values.
7. `recordQaPair` with wrong `candidateId` → error status 404.
8. `finalizeInterviewResult` → `status = 'completed'`, `completed_at` not null; subsequent `recordQaPair` → 409.
9. Stale evaluation (answer changed after evaluation started) is ignored.

Optional HTTP case (mirrors `http-postgres.test.mjs` spawning `index.mjs`): signup a jobseeker (**include `phone`** — signup requires it), assert a `candidates` row exists. `/api/interview/start` requires a live LLM, so the HTTP interview flow is covered by the smoke script below instead.

Run locally (PowerShell):

```powershell
$env:ASSESSMENT_TEST_DATABASE_URL = "postgres://postgres:postgres@localhost:5432/hireright_test"
npm --prefix backend/node test
Remove-Item Env:ASSESSMENT_TEST_DATABASE_URL
```

(Start a local Postgres with `docker run --name hr-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=hireright_test -p 5432:5432 -d postgres:16` if none exists.)

### 3.4 Live end-to-end smoke test against Neon (real Gemini)

Create `backend/node/scripts/smoke-interview-results.mjs` and add `"smoke:interview-results": "node scripts/smoke-interview-results.mjs"` to `backend/node/package.json` (and a root alias `npm --prefix backend/node run smoke:interview-results` in root `package.json` if the root has script aliases for the others like `check:groq`).

The script (uses `fetch`, base URL from `API_URL` env or `http://localhost:8787`):

1. `POST /api/auth/login` with the demo candidate `demo@hireright.com` / `password123` → token.
2. `GET /api/candidates/me` → assert `candidate.email`, `Array.isArray(candidate.resumeSkills ?? candidate.resume_skills)`, and **no** `password_hash` key.
3. `POST /api/interview/start` `{ role: 'Full Stack Engineer', level: '1–3 years' }` → `sessionId`, `question`.
4. `POST /api/interview/answer` index 0 with a realistic 40-word answer → expect **202** in < 1500 ms (print the latency).
5. `POST /api/interview/answer` index 1 with `skipped: true` → 202.
6. Poll `GET /api/interview/results/:sessionId` every 500 ms up to 15 s until index 0 `evaluation.status !== 'pending'`. Print the score and how long scoring took.
7. `POST /api/interview/complete` → `status: 'completed'`, `final_score` = round((score0 + 0) / 2).
8. Print `PASS` and exit 0, or print the failing step and exit 1.

Run (two terminals):

```powershell
npm --prefix backend/node start            # runs node index.mjs
npm --prefix backend/node run smoke:interview-results
```

### 3.5 Manual SQL checks in Neon (SQL editor or `psql "$env:DATABASE_URL"`)

```sql
SELECT id, email, username, array_length(resume_skills, 1) AS skills, left(password_hash, 12) AS hash_prefix
FROM candidates ORDER BY updated_at DESC LIMIT 5;

SELECT id, candidate_name, status, answer_count, scored_count, final_score
FROM candidate_interview_results ORDER BY started_at DESC LIMIT 5;

SELECT q->>'questionIndex' AS idx, q->'question'->>'text' AS question,
       left(q->>'answer', 60) AS answer, q->'evaluation'->>'status' AS eval_status,
       (q->'evaluation'->>'score')::int AS score
FROM candidate_interview_results r, jsonb_array_elements(r.qa_pairs) q
WHERE r.id = '<sessionId>';
```

Expected: `hash_prefix` is a scrypt hash prefix (never a readable password); `final_score` equals the average of the per-question scores.

### 3.6 Manual browser QA checklist

Start both servers (`npm run dev` at root, or backend + `npm --prefix frontend run dev`), log in as the demo candidate, run an interview:

- [ ] Answer Q1 and click **Submit Answer** → next question appears with no added delay (compare with before the change).
- [ ] DevTools → Network: `POST /api/interview/answer` returns **202** for every submit, including the last one and skipped ones.
- [ ] Within ~5 s, the Neon row shows Q1 `evaluation.status = scored` (or `fallback`).
- [ ] Say "end the interview" → that command text is **not** stored as an answer.
- [ ] Finish → row `status = completed`, `final_score` populated.
- [ ] Start another interview and click **Leave** → row `status = abandoned`.
- [ ] Stop the backend mid-interview, submit an answer → UI still advances / shows the existing error; no unhandled promise rejection in console.
- [ ] Sign up a new candidate with phone, upload a resume, finish the profile → `candidates` row has skills from the resume.
- [ ] Existing flows unchanged: dashboard scorecard, `interview_results` (email-keyed) still updated, employer talent search still works.

---

## 4. Edge cases the implementation must handle

| Case | Required behavior |
|---|---|
| LLM down / 429 / quota | Heuristic fallback, `status: 'fallback'`. Interview never blocked. |
| Server restarts mid-interview | Pending evaluations re-run in `/complete`. |
| Client retries same answer | Idempotent by `questionIndex`; no duplicates; existing score kept if text unchanged. |
| Answers out of order (slow network) | `mergeQaPair` keeps array sorted. |
| Session belongs to another user | 404 (don't leak existence). |
| Answer after completion | 409. |
| Huge answer | Truncated to 8000 chars before storage and LLM. |
| Profile has no resume yet | `candidates` row created with empty skill arrays; filled on next `PUT /api/profile`. |
| Employer/admin accounts | No `candidates` row (role ≠ jobseeker). |
| User deleted | `ON DELETE CASCADE` removes candidate + results. |
| Neon unreachable on `/answer` | 500 JSON error; frontend `recordInterviewAnswer` returns false; interview continues. |

---

## 5. Definition of done

- [ ] `schema-candidate-interviews.sql` applied; `npm run db:verify` lists `candidates` and `candidate_interview_results`.
- [ ] New modules: `backend/node/interviewResults/{logic,repository,evaluator}.mjs`.
- [ ] Endpoints: `POST /api/interview/answer` (202), `POST /api/interview/complete`, `GET /api/interview/results`, `GET /api/interview/results/:sessionId`, `GET /api/candidates/me`.
- [ ] Hooks: `/start` creates result row; `/score` finalizes; signup/profile/password changes sync `candidates`; boot backfill.
- [ ] Frontend: every submit (including last + skips) calls `recordInterviewAnswer` in parallel; finish awaits pending writes then completes; Leave marks abandoned.
- [ ] `npm --prefix backend/node test` green (with and without `ASSESSMENT_TEST_DATABASE_URL`).
- [ ] `npm --prefix frontend run build` green.
- [ ] Smoke script prints `PASS` against Neon.
- [ ] No plaintext passwords anywhere; no secrets committed; `git status` shows no `.env` files staged.
- [ ] Update `docs/DATABASE.md` with the two new tables (short section: purpose, columns, write paths).

## 6. Files touched (summary)

| File | Change |
|---|---|
| `backend/node/db/schema-candidate-interviews.sql` | **new** |
| `backend/node/db/applySchema.mjs` | add file to `SCHEMA_FILES`, tables to `EXPECTED_TABLES` |
| `backend/node/db/store.mjs` | export `getReadyPool` |
| `backend/node/interviewResults/logic.mjs` | **new** |
| `backend/node/interviewResults/repository.mjs` | **new** |
| `backend/node/interviewResults/evaluator.mjs` | **new** |
| `backend/node/interviewAgent.mjs` | `export` `analyzeAnswer` (and `callLlmApi` if not already) |
| `backend/node/index.mjs` | hooks + 5 endpoints + `syncCandidateRow` + boot backfill |
| `backend/node/tests/interview-results-logic.test.mjs` | **new** |
| `backend/node/tests/interview-evaluator.test.mjs` | **new** |
| `backend/node/tests/interview-results-postgres.test.mjs` | **new** |
| `backend/node/scripts/smoke-interview-results.mjs` | **new** |
| `backend/node/package.json` | `smoke:interview-results` script |
| `frontend/src/lib/interviewAgentClient.ts` | `recordInterviewAnswer`, `completeInterviewResult` |
| `frontend/src/pages/InterviewPage.tsx` | call sites in `submitAnswer`, `finish`, `leaveInterviewToDashboard` |
| `docs/DATABASE.md` | document new tables |
