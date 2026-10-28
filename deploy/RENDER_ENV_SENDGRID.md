# Render environment — manual dashboard copy

> **Note:** The API uses **Gmail** (`SMTP_EMAIL` + `SMTP_APP_PASSWORD` + optional `EMAIL_FROM`), not SendGrid.  
> Source of truth for Blueprint deploys: root [`render.yaml`](../render.yaml).

Render → your web service → **Environment** → paste from repo-root `.env` where noted.

## Non-secret (production)

| Key | Value |
|-----|--------|
| `NODE_ENV` | `production` |
| `ENVIRONMENT` | `production` |
| `TRUST_PROXY` | `true` |
| `STRICT_PRODUCTION_CONFIG` | `true` |
| `DISABLE_SUPABASE` | `true` |
| `CORS_ORIGINS` | `https://hire-rightt.vercel.app,http://localhost:5173,http://127.0.0.1:5173` |
| `ALLOW_DEMO_ACCOUNTS` | `false` |
| `SIGNUP_ENABLED` | `true` |
| `PUBLIC_APP_URL` | `https://hire-rightt.vercel.app` |
| `INVITE_JOIN_WINDOW_MINUTES` | `5` |
| `MAX_REQUEST_BYTES` | `3000000` |
| `PRIMARY_MODEL` / `FAST_MODEL` / `FALLBACK_MODEL` | `gemini-3.1-flash-lite` |
| `OPENAI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` |
| `S3_DEFAULT_TENANT_ID` | `platform` |
| `S3_PRESIGN_EXPIRES_SECONDS` | `900` |
| `S3_MAX_RECORDING_BYTES` | `104857600` |
| `S3_MAX_REPORT_BYTES` | `12000000` |

**Build command:** `PLAYWRIGHT_INSTALL_CHROMIUM=1 npm install`  
Do **not** set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` or `SCORECARD_PDF_DISABLED=1` if you want report PDFs in S3.

## Secrets (copy from local `.env`)

| Key | Source |
|-----|--------|
| `DATABASE_URL` | Neon URI |
| `SESSION_SECRET` | 32+ chars (Render can generate; do not reuse weak local dev secret in prod) |
| `GEMINI_API_KEY` | Google AI Studio |
| `AWS_REGION` | e.g. `ap-south-2` |
| `S3_BUCKET` | Private files bucket |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | IAM with s3:Put/Get/Head on bucket |
| `SMTP_EMAIL` / `SMTP_APP_PASSWORD` / `EMAIL_FROM` | Gmail app password |

Optional: `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `S3_EXPECTED_BUCKET`, `AWS_SESSION_TOKEN`, backup bucket keys.

## After deploy

1. `https://YOUR-SERVICE.onrender.com/api/health` → `ok: true`, `objectStorage.configured: true`
2. Update `vercel.json` rewrite destination if your Render URL changed
3. Run `npm run s3:cors` locally with `CORS_ORIGINS` including `https://hire-rightt.vercel.app`
