# Render environment — manual dashboard copy

> **Note:** The API uses **Gmail** (`SMTP_EMAIL` + `SMTP_APP_PASSWORD`), not SendGrid.  
> Source of truth for Blueprint deploys: root [`render.yaml`](../render.yaml).

Render → your web service → **Environment** → paste from repo-root `.env` where noted.

## Non-secret (production)

| Key | Value |
|-----|--------|
| `NODE_ENV` | `production` |
| `ENVIRONMENT` | `production` |
| `PORT` | `8787` |
| `TRUST_PROXY` | `true` |
| `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` | `1` |
| `SCORECARD_PDF_DISABLED` | `1` |
| `DISABLE_SUPABASE` | `true` |
| `CORS_ORIGINS` | `https://hire-rightt.vercel.app,http://localhost:5173` |
| `ALLOW_DEMO_ACCOUNTS` | `false` |
| `SIGNUP_ENABLED` | `true` |
| `PUBLIC_APP_URL` | `https://hire-rightt.vercel.app` |
| `INVITE_JOIN_WINDOW_MINUTES` | `5` |
| `PRIMARY_MODEL` / `FAST_MODEL` / `FALLBACK_MODEL` | `gemini-3.5-flash-lite` |
| `OPENAI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` |
| `GROQ_WHISPER_MODEL` | `whisper-large-v3-turbo` |
| `GROQ_WHISPER_LANGUAGE` | `en` |
| `S3_DEFAULT_TENANT_ID` | `platform` |
| `S3_PRESIGN_EXPIRES_SECONDS` | `900` |
| `S3_MAX_RECORDING_BYTES` | `104857600` |
| `S3_MAX_REPORT_BYTES` | `12000000` |

## Secrets (copy from local `.env`)

| Key | Source |
|-----|--------|
| `DATABASE_URL` | Neon URI |
| `SESSION_SECRET` | 32+ chars (do not reuse local dev string in prod) |
| `GEMINI_API_KEY` | Same as local |
| `AWS_REGION` | e.g. `ap-south-2` |
| `S3_BUCKET` | e.g. your `hirerighttt-*` bucket |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | IAM S3 user |
| `GROQ_API_KEY` | Optional STT |
| `SMTP_EMAIL` / `SMTP_APP_PASSWORD` / `EMAIL_FROM` | Gmail app password |

## Verify

```bash
curl "https://YOUR-SERVICE.onrender.com/api/health"
curl "https://YOUR-SERVICE.onrender.com/api/mail/status?verify=1"
```

Health should show `objectStorage.configured: true` when S3 vars are set.
