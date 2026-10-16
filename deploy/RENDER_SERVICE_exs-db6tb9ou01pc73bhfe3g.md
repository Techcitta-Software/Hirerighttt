# Render service `exs-db6tb9ou01pc73bhfe3g` ↔ Vercel frontend

## Render (Node API — required settings)

In [Render Dashboard](https://dashboard.render.com) → service **exs-db6tb9ou01pc73bhfe3g**:

| Setting | Value |
|---------|--------|
| **Repository** | `bharath-techcitta/HireRighttt-backend` |
| **Branch** | `dev` (or `main`) |
| **Root Directory** | `backend/node` |
| **Build Command** | `npm install` |
| **Start Command** | `node index.mjs` |
| **Health Check Path** | `/api/health` |

### Environment variables (paste from Neon + keys)

| Key | Value |
|-----|--------|
| `DATABASE_URL` | Your Neon URI (same as local `.env`) |
| `GEMINI_API_KEY` | Server Gemini key |
| `SESSION_SECRET` | 32+ random characters |
| `ENVIRONMENT` | `production` |
| `NODE_ENV` | `production` |
| `PORT` | `8787` |
| `CORS_ORIGINS` | `https://hire-rightt.vercel.app,http://localhost:5173` |
| `PUBLIC_APP_URL` | `https://hire-rightt.vercel.app` |
| `ALLOW_DEMO_ACCOUNTS` | `true` (or `false` in prod) |
| `SIGNUP_ENABLED` | `true` |

After deploy, copy **your service URL** (e.g. `https://something.onrender.com`) and confirm:

`https://YOUR-SERVICE.onrender.com/api/health` → `{"ok":true,"service":"hireright-api",...}`

If you see `{"detail":"Not Found"}`, the service is **not** running the Node API (wrong root/start command).

## Vercel (frontend)

Project: **hire-rightt** → Settings → Environment Variables:

| Key | Value |
|-----|--------|
| `RENDER_API_URL` | `https://hireright-backend-ykln.onrender.com` (optional; rewrite in `vercel.json` is primary) |
| `VITE_API_URL` | *(leave empty)* — browser uses same-origin `/api` via proxy |

Redeploy production after saving env vars.
