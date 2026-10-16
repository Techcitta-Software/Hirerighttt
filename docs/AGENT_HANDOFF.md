# HireRighttt — Agent handoff (continue from here)

> **2026 update:** Single **repo-root `.env`** only ([env/README.md](../env/README.md)). **Neon Postgres + Node auth** (Supabase removed). Some sections below are historical — prefer [DATABASE.md](./DATABASE.md) and [README.md](../README.md).

This document is for **human + AI agents** picking up the repo. Read this before making large changes.

## Product goal

**HireRighttt** is an AI hiring platform: candidate onboarding, **Ava** (adaptive AI video interview), **Career Intelligence scorecard**, job matching, employer ATS.

Primary loop to keep working end-to-end:

1. Sign up / sign in (prefer **Supabase Auth** in production).
2. Build profile + upload resume.
3. `/interview` — camera, speech, adaptive Q&A.
4. Score + **CareerIntelligenceDashboard** + sync to Supabase `interview_results`.
5. Jobs / apply flows (localStorage + Node KV still used for some employer data).

## Architecture (authoritative paths)

| Layer | Location | Role |
|--------|-----------|------|
| UI | `frontend/` (Vite, React 19) | All pages, interview UX, dashboard |
| **Interview API (default)** | `backend/node/` | Auth, Postgres KV, **adaptive interview**, resume parse, **scorecard** |
| Optional API | `backend/python/` | FastAPI; interview parity partial — **Node owns adaptive `/next`** |
| Supabase schema | `supabase/migrations/001_hireright_schema.sql` | `profiles`, `interview_results`, RLS, auth trigger |
| Prod deploy | `docker-compose.supabase.prod.yml`, `deploy/nginx.conf` | API + static web; **no bundled DB** when using Supabase |

```text
Browser → Vite (dev) or nginx (prod)
           ├─ /api/* → Node (8787)
           └─ Supabase client → Auth + profiles/interview_results (RLS)

Node API auth:
  Authorization: Bearer <Supabase access JWT>  OR  Node session token (demo/local)

Node persistence:
  DATABASE_URL set → hireright_kv (JSON blob) + hireright_sessions in Postgres
  Same Supabase DB also has public.profiles / public.interview_results (normalized sync)
```

## Environment

**One file only:** repo-root `.env` (see [env/README.md](../env/README.md)).

```bash
cp .env.example .env
npm run check:env
npm run dev:all
```

Required: `DATABASE_URL` (Neon), `SESSION_SECRET`, `GEMINI_API_KEY`. Optional `VITE_*` in the **same** file for Vite.

Do **not** use `frontend/.env`, `backend/node/.env`, or Supabase.

## Run locally

```bash
npm install
npm run dev:all
```

- App: http://localhost:5173  
- API: http://localhost:8787/api/health (check `llm: true` when `GEMINI_API_KEY` is set)

Demo (no Supabase): `demo@hireright.com` / `password123` — disabled in prod when `ALLOW_DEMO_ACCOUNTS=false`.

## Ava interview — how it works

**Frontend**

- `frontend/src/pages/InterviewPage.tsx` — lobby, TTS, STT, proctoring, submit flow.
- `frontend/src/lib/interviewAgentClient.ts` — start / turn / score via API; **no browser LLM in prod** (`clientLlm.ts`).
- `frontend/src/lib/adaptiveInterview.ts` — `/api/interview/next` + local fallback (e.g. “good at Java”).

**Backend**

- `POST /api/interview/start` — `adaptive: true` → first question from resume/name.
- `POST /api/interview/turn` — Ava spoken bridge after each answer.
- `POST /api/interview/next` — next question from last answer + history.
- `POST /api/interview/score` — full result + **`scorecard`**.
- Logic: `backend/node/interviewAgent.mjs` (`generateAdaptiveQuestion`, `generateInterviewTurn`, `scoreInterviewSession`, `buildCareerScorecard`).

**Auth:** All interview routes need `Bearer` token. Frontend: `apiSession.ts` + `/api/login` → `localStorage` (`hireright.apiToken`).

**Interactive means:** one question at a time; after submit → bridge speech → **new** adaptive question (not a fixed 5-question bank). Max ~15 adaptive turns; voice “end the interview” supported.

## Scorecard

- Built server-side in `buildCareerScorecard()` inside `scoreInterviewSession()`.
- UI: `frontend/src/components/CareerIntelligenceDashboard.tsx` uses `result.scorecard` when present.
- Persist: `store.saveInterviewResult()` → localStorage + `apiSync.syncInterviewResultToApi()`.
- **Full scorecard requires** successful `POST /api/interview/score`. Local-only fallback has thinner UI (synthesized donuts from `overall`).

## Postgres sync (Neon)

| Data | Table | Code |
|------|--------|------|
| Profile JSON | `profiles` | `apiSession.syncProfileToApi` |
| Interview result | `interview_results` | `apiSync.syncInterviewResultToApi` |
| Auth | `users` + `hireright_sessions` | `AuthPages.tsx`, `/api/login` |

## Production

```bash
npm run prod:neon
# docker compose -f docker-compose.prod.yml up -d --build
```

- `backend/node/config.mjs` — `assertProductionConfig()` on boot.
- Frontend Docker build: repo root context, `deploy/nginx.conf`.
- Do **not** pass `VITE_GEMINI_*` into production web build.

CI: `.github/workflows/ci.yml`.

## Known gaps / sensible next tasks

Pick up any of these without re-architecting unless asked:

1. **Employer / admin flows** — wire jobs to Neon `jobs` table (still partly localStorage).
2. **Single source of truth** — finish API for employer jobs/applications vs localStorage.
3. **Local score fallback** — optionally call same scorecard builder on client or require API for score (UX when offline).
4. **Pass `nextQuestion` into `/api/interview/turn`** for richer bridges (InterviewPage currently omits it).
5. **TLS + domain** — terminate HTTPS in front of `WEB_PORT`.
6. **Rotate secrets** if they were ever pasted in chat or committed in old history.
7. **E2E** — extend `e2e/candidate-journey.spec.ts` for full interview path via `/api/login`.

## Key files (quick index)

```
frontend/src/pages/InterviewPage.tsx      # Ava UX
frontend/src/lib/adaptiveInterview.ts     # next question client
frontend/src/lib/apiSession.ts            # Bearer sync
frontend/src/lib/apiSync.ts                 # Profile + interview sync
backend/node/index.mjs                      # HTTP routes
backend/node/interviewAgent.mjs             # LLM + scorecard
backend/node/db/store.mjs                   # Neon Postgres
env/loadEnv.mjs                             # Single .env loader
backend/node/config.mjs                     # prod guards
supabase/migrations/001_hireright_schema.sql
docker-compose.supabase.prod.yml
docs/AGENT_HANDOFF.md                       # this file
docs/AGENT_LOCAL_SECRETS.md                 # copy-paste .env for agents
```

## Agent conventions (this repo)

- **Minimize scope** — small focused diffs; match existing patterns.
- **Do not commit** `.env` or `frontend/.env`; team dev keys live in `docs/AGENT_LOCAL_SECRETS.md` (rotate if repo access changes).
- **Production:** LLM keys only on Node server; use `clientLlmAllowed()` pattern for any new client AI calls.
- **Default API** for interview features is **Node**, not Python.
- Run `npm run lint` and `npm run build` before pushing.

## Verify E2E (manual smoke)

1. Supabase sign-up → profile save → row in `profiles`.
2. Interview → mention a skill in answer → next question targets it.
3. Finish → dashboard shows Q&A rows; `interview_results` row in Supabase.
4. Network: `/api/interview/start`, `/next`, `/turn`, `/score` return 200 with Bearer token.

---

*Last updated: handoff after Supabase integration + production Docker/CI. Update this file when you change auth, interview API contracts, or deploy topology.*
