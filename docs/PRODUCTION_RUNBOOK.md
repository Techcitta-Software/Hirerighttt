# Production runbook (match local behavior)

## How local works

```bash
npm run dev:all
```

- UI: http://localhost:5173 (Vite proxies `/api` → `localhost:8787`)
- API: Node in `backend/node`, **PostgreSQL via `DATABASE_URL`** in repo-root `.env`
- Health: http://localhost:8787/api/health includes **`database`**, **`models`**, **`apiBuildId`**

## Production URLs

| Layer | URL |
|-------|-----|
| Frontend | https://hire-rightt.vercel.app |
| API (direct) | https://hireright-backend-ykln.onrender.com |
| API (via Vercel) | https://hire-rightt.vercel.app/api/health |

`vercel.json` rewrites `/api/*` → Render. Keep **`VITE_API_URL` empty** on Vercel.

## Verify (run anytime)

```bash
npm run verify:prod
```

**Modern API** = health JSON contains `database` and `models`. If Render shows **NO**, it is still an old deploy.

## Render — required (your dashboard)

Service: **hireright-backend-ykln** (`exs-db6tb9ou01pc73bhfe3g`)

| Setting | Value |
|---------|--------|
| Git repo | `bharath-techcitta/HireRighttt-backend` |
| Branch | **`main`** |
| Root directory | **`backend/node`** |
| Build command | `npm install` |
| Start command | `node index.mjs` |
| Health check | `/api/health` |

### Environment variables (copy from local `.env` where noted)

| Key | Required |
|-----|----------|
| `DATABASE_URL` | **Yes** — same Neon URI as local |
| `GEMINI_API_KEY` | **Yes** — same as local |
| `SESSION_SECRET` | **Yes** — 32+ random chars |
| `ENVIRONMENT` | `production` |
| `NODE_ENV` | `production` |
| `PORT` | `8787` |
| `CORS_ORIGINS` | `https://hire-rightt.vercel.app,http://localhost:5173` |
| `PUBLIC_APP_URL` | `https://hire-rightt.vercel.app` |
| `ALLOW_DEMO_ACCOUNTS` | `true` (or `false` later) |
| `SIGNUP_ENABLED` | `true` |
| `API_BUILD_ID` | optional tag (default in code) |

After saving env vars: **Manual Deploy** → deploy latest **`main`** commit.

> New API **exits on boot** without `DATABASE_URL`. If deploy fails, Render may keep serving the previous (old) version — fix env, then redeploy.

## Vercel

- Project **hire-rightt** linked to `bharath-techcitta/HireRighttt-backend`, branch **`main`**
- Do **not** set `VITE_API_URL` in production (use `/api` proxy)
- Optional: `RENDER_API_URL` = `https://hireright-backend-ykln.onrender.com`

Redeploy after Git push or run `npx vercel deploy --prod`.

## Git flow

1. Work on **`dev`**, push to GitHub
2. Merge **`dev` → `main`**, push `main`
3. Render auto-deploy (if connected) or Manual Deploy
4. Vercel auto-deploy or CLI deploy
