# Connect [HireRighttt-backend](https://github.com/bharath-techcitta/HireRighttt-backend) to Vercel + Render

Monorepo layout: **frontend** at `frontend/`, **Node API** at `backend/node/`. Root `vercel.json` and `render.yaml` are already configured.

## 1. GitHub (source of truth)

- Repo: **https://github.com/bharath-techcitta/HireRighttt-backend**
- Deploy branches: **`main`** (production) and **`dev`** (integration)

Push latest:

```bash
git push origin main
git push origin dev
```

## 2. Vercel — frontend

1. [Vercel Dashboard](https://vercel.com/dashboard) → **Add New** → **Project**.
2. Import **bharath-techcitta/HireRighttt-backend** (install GitHub app if prompted).
3. **Configure:**
   - **Root Directory:** `.` (repository root)
   - **Framework:** Vite (or use existing `vercel.json`)
   - **Build Command:** `npm run build`
   - **Output Directory:** `frontend/dist`
4. **Environment variables** (Production):

   | Key | Value |
   |-----|--------|
   | `VITE_API_URL` | **Leave empty** — root `vercel.json` proxies `/api/*` to Render |
   | `VITE_AUTH_PROVIDER` | `api` |

   If the live site is stale after a Git push: **Deployments → … → Redeploy** (uncheck “Use existing Build Cache”).

5. **Deploy**. Production URL example: `https://hire-rightt.vercel.app`
6. **Settings → Git** → Production Branch: `main` (optional: Preview for `dev`).

CLI (already linked project `hire-rightt`):

```bash
npx vercel --prod
```

## 3. Render — backend

### Blueprint (recommended)

1. [Render Dashboard](https://dashboard.render.com) → **New +** → **Blueprint**.
2. Connect GitHub → select **bharath-techcitta/HireRighttt-backend**.
3. Branch: **`main`** (or `dev` for staging).
4. Render reads root [`render.yaml`](../render.yaml) → service **`hireright-backend`**.
5. Set secrets when prompted:
   - `DATABASE_URL` (Neon/Supabase Postgres)
   - `GEMINI_API_KEY`
   - `PUBLIC_APP_URL` = your Vercel URL
   - `CORS_ORIGINS` = `https://YOUR-VERCEL-APP.vercel.app,http://localhost:5173`
   - SMTP_* (optional, for interview invite emails)

### Manual web service

| Field | Value |
|-------|--------|
| Root Directory | `backend/node` |
| Build | `npm install` |
| Start | `node index.mjs` |
| Health check | `/api/health` |

Verify: `https://YOUR-SERVICE.onrender.com/api/health` → `{"ok":true,"service":"hireright-api",...}`

## 4. Wire frontend ↔ backend

After both URLs exist:

1. **Vercel** → set `VITE_API_URL` → **Redeploy**.
2. **Render** → set `CORS_ORIGINS` to your Vercel domain → save (auto-restart).

## 5. GitHub Actions (optional)

In repo **Settings → Secrets and variables → Actions**:

- **Vercel:** `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
- **Render:** `RENDER_DEPLOY_HOOK` (from Render → Service → Deploy Hook)

Workflows: `.github/workflows/deploy-vercel.yml`, `deploy-render.yml`.
