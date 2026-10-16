# HireRight — Interview Question Generation Spec (for AI agents)

This document tells an AI coding agent **how to generate the next Ava interview question** the same way the running app does today. Follow it when implementing, testing, or replicating question generation **without** reading the whole codebase first.

**Authoritative server implementation:** `backend/node/interviewAgent.mjs` → `generateAdaptiveQuestion()`, `summarizeProfile()`, `normalizeAdaptiveQuestion()`.

**Production entrypoints:**

| When | API | Function |
|------|-----|----------|
| Interview start (Q1) | `POST /api/interview/start` | `generateAdaptiveQuestion({ history: [], lastAnswer: '' })` |
| After each submit (Q2+) | `POST /api/interview/next` | Same function with updated `history` + `lastAnswer` |

There is **no fixed question bank** in the adaptive path: **one new LLM question per turn**.

---

## 0. Agent rules (read first)

| Rule | Why |
|------|-----|
| Output **exactly one** question per invocation. | Matches live interview UX (one question at a time). |
| Return **JSON only** in the shape in §4; the app extracts the first `{...}` block from model text. | Parser tolerates markdown fences / prose around JSON. |
| **Never repeat** a prior question text (or the same first ~40 characters). | Enforced by `normalizeAdaptiveQuestion` + prompt. |
| **Do not invent** employers, degrees, or projects not present in `resumeSnippet` / profile. | Resume-accuracy requirement in system prompt. |
| Use **`category`** only from: `Communication`, `Technical`, `Problem Solving`, `Experience`. | Invalid categories default to `Technical`. |
| **`text` length ≥ 24** characters after trim or the question is rejected. | Server validation. |
| Default interview length context: **6 turns** (`INTERVIEW_TURN_COUNT` / `PROFESSIONAL_INTERVIEW_LENGTH`). | Prompt says “question N of 6”. |
| Question generation uses LLM tier **`quality`** (model cascade from env, default Gemini Flash Lite). | Not the same as per-answer scoring (`fast` tier). |
| If replicating offline, use the **same system + user JSON** below; do not substitute a generic “ask behavioral questions” prompt. | Behavior drift breaks resume-aware flow. |

**Environment (repo root `.env`):**

- `GEMINI_API_KEY` (optional). When it is missing, or both temperatures fail validation, the server uses `generateAdaptiveQuestionLocal()` — the same one-question rules, with no invented employers.
- `PRIMARY_MODEL=gemini-3.1-flash-lite` (default)
- `FALLBACK_MODEL=gemini-3.5-flash-lite`
- `LITE_FALLBACK_MODEL=gemini-flash-lite-latest`

---

## 1. Inputs you must assemble

Before calling the LLM, build a **profile digest** (`ctx`) equivalent to `summarizeProfile(profile, accountName)`.

### 1.1 Raw profile (from API body or wizard)

Typical fields on `profile` / `SavedProfile`:

- `fullName`, `name`, `currentRole`, `totalExperience`, `skills[]`
- `workExperiences[]` → `{ jobTitle, company, description }`
- `achievements[]`, `certifications[]` → `{ name }`
- `resumeText`, `resumeName`
- Optional narrative: `whoAreYou`, `whatDrivesYou`, `keyStrengths`, `experienceSummary`

### 1.2 Resolved candidate name

Use the same priority as `resolveCandidateName()`:

1. Profile `fullName` or `name` (skip demo placeholder **“Arjun Sharma”** if used as generic demo label)
2. First plausible name line from first 10 lines of `resumeText` (Title Case pattern)
3. Heuristic from `resumeName` filename
4. Account name from signup
5. Fallback: **`Candidate`**

**First name for spoken questions:** `firstNameFromFull(name)` → first token, or **`there`** if name is missing/demo → prompt says: do not use fake names; use “you”.

### 1.3 `ctx` object (pass to LLM as `candidateSummary`)

| Field | Max / shape |
|-------|-------------|
| `name` | Resolved full name |
| `skills` | Up to **16** unique trimmed strings |
| `jobs` | Up to **4** lines: `"Title @ Company: description…"` (description truncated ~180 chars) |
| `achievements` | Up to **5** strings |
| `resumeSnippet` | First **3500** chars of `resumeText` (user payload uses **2800**) |

### 1.4 Session parameters

| Param | Source | Default |
|-------|--------|---------|
| `role` | Interview UI / body | `Full Stack Engineer` |
| `level` | Experience band | `1–3 years` |
| `jobDescription` | Optional JD paste | empty |
| `history` | `{ question, answer }[]` from prior turns | `[]` on start |
| `lastAnswer` | Text of most recent answer | `''` on start |
| `turnNumber` | `history.length + 1` | 1 on start |

### 1.5 Prior questions list

```js
priorTexts = history.map(h => trim(h.question.text || h.question)).filter(Boolean)
```

Send as `priorQuestions` in the user JSON so the model avoids duplicates.

---

## 2. LLM call (production parity)

### 2.1 Models and retries

- Call **`callLlmApi({ system, user, temperature, tier: 'quality' })`**.
- Try **`temperature: 0.62`**, then **`0.42`** if parse/validation fails.
- Model cascade: `PRIMARY_MODEL` → `FALLBACK_MODEL` → `LITE_FALLBACK_MODEL` (see `backend/node/llmModels.mjs`).

### 2.2 System prompt (copy exactly — replace `${}` at runtime)

```
You are Ava, a realistic professional interviewer on a live video call. Generate exactly ONE new interview question (JSON only).

Rules:
- This is question {turnNumber} of {INTERVIEW_TURN_COUNT}. Never repeat or lightly rephrase any prior question.
- Use the candidate resume, role "{role}", experience "{level}", job description (if any), and their last answer to choose the next realistic topic.
- One clear idea per question — how a real hiring manager speaks.
- {NAME_RULE}
- Do not invent employers, degrees, or projects absent from the resume snippet.
- category must be one of: Communication, Technical, Problem Solving, Experience.

Return ONLY: {"question":{"text":"...","category":"...","keywords":["..."],"hint":"...","topic":"...","resumeAnchor":"optional"}}
```

**`NAME_RULE`:**

- If `first === 'there'`:  
  `Do NOT use fake names (no Arjun, no Candidate). Start neutrally or with "you".`
- Else:  
  `You may use the first name "{first}" once if natural.`

**`INTERVIEW_TURN_COUNT`:** `6`

### 2.3 User message (JSON string)

```json
{
  "turnNumber": 1,
  "totalTurns": 6,
  "roleTrack": "Full Stack Engineer",
  "experienceLevel": "1–3 years",
  "jobDescription": null,
  "candidateSummary": {
    "skills": ["React", "Node.js"],
    "jobs": ["Software Engineer @ Acme: Built APIs…"],
    "achievements": ["Reduced latency 30%"],
    "resumeSnippet": "…"
  },
  "priorQuestions": ["…"],
  "lastAnswer": "… or null on first question"
}
```

### 2.4 Follow the last answer (critical behavior)

The app does **not** use a separate rules engine for “good at Java” on the server path today; the **LLM** must:

- Read **`lastAnswer`** and drill into claims (skills, stacks, projects, metrics).
- Pivot to an **unasked** resume topic when the answer is thin.
- Align difficulty with **`experienceLevel`** (fresher → projects/education; senior → trade-offs, ownership).

Optional reference patterns (used in local template helpers in the same file — useful if you add a non-LLM fallback):

- **Full-stack claim:** end-to-end feature (UI, API, DB, auth, testing).
- **Math/analytics claim:** problem setup, method, verification.
- **Generic skill claim:** situation → actions → outcome in `{role}` context.

---

## 3. Parse and validate output

### 3.1 Extract JSON

1. Regex first `{...}` block from model text (may include ```json fences).
2. Parse JSON; read `parsed.question` or root object as question.

### 3.2 `normalizeAdaptiveQuestion(raw, priorTexts)`

Reject (return null → retry other temperature / fail) if:

- `text` missing or length **< 24**
- `text` equals any prior question, or **first 40 chars** match a prior question

On success, return:

```ts
{
  text: string,                    // trimmed
  category: 'Communication' | 'Technical' | 'Problem Solving' | 'Experience',
  keywords: string[],              // up to 12, lowercased, unique
  hint: string,                    // default: 'Give a concrete example with tools and outcome.'
  topic: string,                   // default category or 'Interview'
  resumeAnchor?: string,
  focus: 'adaptive-llm',
}
```

Invalid `category` → **`Technical`**.

### 3.3 Failure behavior (server)

If `GEMINI_API_KEY` is missing, or both temperatures fail validation:

- Return **one** question from `generateAdaptiveQuestionLocal()` (`focus: 'adaptive-local'`).
- That path still enforces length ≥ 24, no repeated 40-character prefix, allowed categories, the name rule, and résumé-only facts.
- Turn 1 uses `buildFirstAdaptiveQuestionLocal()`. Later turns drill into a new skill claim, then an unasked résumé topic, then a role-level question.
- `POST /api/interview/start` still returns **200** with `question.text`.

Client fallback (API unreachable): `generateAdaptiveQuestionClient()` in `frontend/src/lib/interviewQuestionGeneration.ts` uses the same prompt, then the same local rules when `VITE_GEMINI_API_KEY` is absent.

---

## 4. Question object schema (TypeScript)

Matches `frontend/src/lib/interviewEngine.ts`:

```ts
type Question = {
  text: string
  category: 'Communication' | 'Technical' | 'Problem Solving' | 'Experience'
  keywords: string[]   // used later in answer scoring heuristics
  hint: string         // UI helper for candidate
  resumeAnchor?: string
  topic?: string
  focus?: string
}
```

---

## 5. End-to-end flow (agent checklist)

```text
1. Load profile + account name → summarizeProfile → ctx
2. turn = history.length + 1
3. Build system prompt (turn, role, level, first name rule)
4. Build user JSON (summary, priorQuestions, lastAnswer, JD)
5. callLlmApi quality tier, temp 0.62 → parse → normalize
6. If null, retry temp 0.42
7. Return Question or throw
```

**After the candidate answers** (app behavior, not question gen):

- `POST /api/interview/turn` — short spoken bridge (fast tier, separate prompt; **must not** ask a new question).
- `POST /api/interview/next` — repeat steps 1–7 with `history` including the pair just answered.

---

## 6. Turn 1 expectations (no separate code path)

Question 1 uses the **same** `generateAdaptiveQuestion` with empty history. The model should still:

- Open appropriately for **`level`** (fresher: education/projects; experienced: recent role impact).
- Prefer **`resumeSnippet`** and **`jobs[0]`** when present.
- Set **`category`** often to `Communication` or `Experience` for intros, but LLM may choose any valid category.

When Gemini is not configured, turn 1 uses `buildFirstAdaptiveQuestionLocal()` inside `generateAdaptiveQuestionLocal()`.

---

## 7. Related but different: fixed 5-question batch

`generateLlmQuestions()` in the same file generates **5 questions at once** for legacy/batch flows. **Do not use** that prompt for the live adaptive interview; adaptive uses **§2** only.

---

## 8. Testing question generation

### 8.1 Server ping

```bash
npm --prefix backend/node run check:llm
```

### 8.2 Manual API (Bearer token required)

```http
POST /api/interview/start
Authorization: Bearer <token>
Content-Type: application/json

{
  "role": "Full Stack Engineer",
  "level": "1–3 years",
  "profile": { "skills": ["React"], "resumeText": "…" }
}
```

Expect `200` with `question.text`, `sessionId`, `adaptive: true`.

```http
POST /api/interview/next
…
{
  "sessionId": "<id>",
  "role": "Full Stack Engineer",
  "level": "1–3 years",
  "history": [{ "question": { "text": "…", "category": "Experience" }, "answer": "…" }],
  "lastQuestion": { "text": "…", "category": "Experience" },
  "lastAnswer": "…"
}
```

### 8.3 Agent self-test script pattern

1. Mock `ctx` from a sample resume.
2. Run generation for turn 1 → assert schema + length.
3. Run turn 2 with `lastAnswer` mentioning a new skill → assert question references that skill or resume.
4. Run turn 2 again with same `priorQuestions` → assert **different** text (no duplicate prefix).

---

## 9. Common mistakes (avoid)

| Mistake | Symptom |
|---------|---------|
| Generating multiple questions in one call | Breaks adaptive UX |
| Ignoring `priorQuestions` | Repeated questions; validation fails |
| Using `fast` tier for questions | Works sometimes but not production default |
| Inventing company names not in resume | Breaks trust / product rules |
| Skipping API auth | `/interview/start` returns 401; client shows errors |
| Frontend-only dev without API on 8787 | Offline `local-*` sessions; no Neon storage |

---

## 10. File map (quick navigation)

| File | Role |
|------|------|
| `backend/node/interviewAgent.mjs` | `generateAdaptiveQuestion`, prompts, `summarizeProfile` |
| `backend/node/llmModels.mjs` | Model cascade, env defaults |
| `backend/node/index.mjs` | `/api/interview/start`, `/api/interview/next` |
| `frontend/src/lib/interviewAgentClient.ts` | `startInterviewSession`, API wiring |
| `frontend/src/lib/adaptiveInterview.ts` | `fetchNextAdaptiveQuestion`, client LLM fallback |
| `frontend/src/lib/interviewEngine.ts` | `Question` type, role/level enums |
| `frontend/src/pages/InterviewPage.tsx` | Submit → next question loop |

---

## 11. Minimal agent implementation pseudocode

```js
async function generateNextQuestion({ profile, accountName, role, level, jobDescription, history, lastAnswer }) {
  const ctx = summarizeProfile(profile, accountName)
  const first = firstNameFromFull(ctx.name)
  const turn = history.length + 1
  const priorTexts = history.map(h => clean(h.question?.text)).filter(Boolean)

  const system = buildSystemPrompt({ turn, role, level, first, total: 6 })
  const user = JSON.stringify({
    turnNumber: turn,
    totalTurns: 6,
    roleTrack: role,
    experienceLevel: level,
    jobDescription: jobDescription || null,
    candidateSummary: {
      skills: ctx.skills.slice(0, 16),
      jobs: ctx.jobs.slice(0, 6),
      achievements: ctx.achievements.slice(0, 5),
      resumeSnippet: ctx.resumeSnippet.slice(0, 2800),
    },
    priorQuestions: priorTexts,
    lastAnswer: lastAnswer || null,
  })

  const localArgs = { profile, accountName, role, level, jobDescription, history, lastAnswer }
  if (!geminiKeyConfigured()) return generateAdaptiveQuestionLocal(localArgs)

  for (const temperature of [0.62, 0.42]) {
    const llm = await callLlmApi({ system, user, temperature, tier: 'quality' })
    if (!llm?.text) continue
    const parsed = extractFirstJsonObject(llm.text)
    const q = normalizeAdaptiveQuestion(parsed.question || parsed, priorTexts)
    if (q) return q
  }
  return generateAdaptiveQuestionLocal(localArgs)
}
```

When this spec and `interviewAgent.mjs` disagree, **treat `interviewAgent.mjs` as source of truth** and update this file in the same PR.
