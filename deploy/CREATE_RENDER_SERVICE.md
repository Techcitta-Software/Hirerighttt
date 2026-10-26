# Create a new Render backend (after deleting the old service)

Repo: **bharath-techcitta/HireRighttt-backend** · branch **`main`**

## Option A — Blueprint (recommended)

Uses root [`render.yaml`](../render.yaml) (includes `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`).

1. [Render Dashboard](https://dashboard.render.com) → **New +** → **Blueprint**.
2. Connect GitHub → select **HireRighttt-backend**.
3. Branch: **`main`** → **Apply**.
4. When prompted, set **secret** env vars (same values as local repo-root `.env`):
   - **`DATABASE_URL`** — Neon Postgres URI (required)
   - **`GEMINI_API_KEY`** — required for production interviews
   - **`SMTP_EMAIL`**, **`SMTP_APP_PASSWORD`**, **`EMAIL_FROM`** — Gmail (same as local `.env`)
   - Optional S3: **`AWS_REGION`**, **`S3_BUCKET`**, **`AWS_ACCESS_KEY_ID`**, **`AWS_SECRET_ACCESS_KEY`**
5. Wait for **Build** → **Live**. Copy the service URL, e.g. `https://hireright-backend-xxxx.onrender.com`.

## Option B — Manual Web Service

| Setting | Value |
|---------|--------|
| **Name** | `hireright-backend` (any name; URL will include a suffix) |
| **Region** | Oregon (or nearest) |
| **Branch** | **`main`** |
| **Root Directory** | **`backend/node`** |
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `node index.mjs` |
| **Health Check Path** | `/api/health` |
| **Instance** | Free (or paid) |

### Environment variables (minimum)

| Key | Value |
|-----|--------|
| `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` | `1` |
| `NODE_ENV` | `production` |
| `ENVIRONMENT` | `production` |
| `PORT` | `8787` |
| `DATABASE_URL` | Neon URI |
| `GEMINI_API_KEY` | your key |
| `SESSION_SECRET` | 32+ random characters |
| `CORS_ORIGINS` | `https://hire-rightt.vercel.app,http://localhost:5173` |
| `PUBLIC_APP_URL` | `https://hire-rightt.vercel.app` |
| `ALLOW_DEMO_ACCOUNTS` | `false` |
| `SIGNUP_ENABLED` | `true` |
| `DISABLE_SUPABASE` | `true` |
| `AWS_REGION` | e.g. `ap-south-2` (match your bucket) |
| `S3_BUCKET` | your private bucket name |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | IAM user with S3 access |
| `GROQ_API_KEY` | optional server STT |
| `SMTP_EMAIL` / `SMTP_APP_PASSWORD` / `EMAIL_FROM` | Gmail app password |

Full list: root **`render.yaml`** (Blueprint) or mirror keys from repo-root **`.env.example`**.

---

## Verify the API

```bash
curl https://YOUR-NEW-SERVICE.onrender.com/api/health
```

Expect JSON with `"ok":true`, `"service":"hireright-api"`, `"database":{"connected":true}`, and a fresh **`deployRef`** (git commit SHA).

---

## Wire Vercel to the new backend (required)

The old URL **`hireright-backend-ykln.onrender.com`** is gone. Update the proxy:

1. Edit root **`vercel.json`** → `rewrites` → `/api/:path*` **destination** →  
   `https://YOUR-NEW-SERVICE.onrender.com/api/:path*`
2. Commit and push **`main`**, or redeploy on Vercel after push.
3. Optional: update **`scripts/verify-production.mjs`** / docs if you use them.
4. Test: https://hire-rightt.vercel.app/api/health (should match Render health).

---

## GitHub Actions deploy hook (optional)

1. Render → your service → **Settings** → **Deploy Hook** → copy URL.
2. GitHub repo → **Settings → Secrets → Actions** → **`RENDER_DEPLOY_HOOK`** → paste URL.
3. Pushes to `main` that touch `backend/node/` will trigger redeploys.

---

## After you have the new URL

Paste the Render URL here (or update `vercel.json` yourself) so production `/api` works again.
