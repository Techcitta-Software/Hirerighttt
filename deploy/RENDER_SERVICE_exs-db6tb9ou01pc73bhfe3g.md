# Render service `exs-db6tb9ou01pc73bhfe3g` ↔ Vercel frontend

## Render (Node API — required settings)

In [Render Dashboard](https://dashboard.render.com) → service **exs-db6tb9ou01pc73bhfe3g**:

| Setting | Value |
|---------|--------|
| **Repository** | `bharath-techcitta/HireRighttt-backend` |
| **Branch** | **`dev`** (required — `main` on GitHub is behind; do not deploy `main` until merged) |
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
| `INVITE_JOIN_WINDOW_MINUTES` | `5` |
| `ALLOW_DEMO_ACCOUNTS` | `false` |
| `SIGNUP_ENABLED` | `true` |
| `SMTP_HOST` | `smtp.sendgrid.net` |
| `SMTP_PORT` | `587` |
| `SMTP_SECURE` | `false` |
| `SMTP_USER` | `apikey` |
| `SMTP_PASS` | SendGrid API key (`SG....`) |
| `SMTP_FROM` | `HireRight <verified@yourdomain.com>` |

Full SendGrid checklist: [RENDER_ENV_SENDGRID.md](./RENDER_ENV_SENDGRID.md)

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
