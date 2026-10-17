# Render environment — copy into Dashboard

**Service:** `hireright-backend` (ID `exs-db6tb9ou01pc73bhfe3g`)  
**Path:** Render → your service → **Environment** → Add / Edit → **Save Changes** → **Manual Deploy**

Paste each **Key** / **Value** below. Secrets must be your real values (not placeholders).

## Already set / non-secret (use these exact values)

| Key | Value |
|-----|--------|
| `NODE_ENV` | `production` |
| `ENVIRONMENT` | `production` |
| `PORT` | `8787` |
| `CORS_ORIGINS` | `https://hire-rightt.vercel.app,http://localhost:5173` |
| `ALLOW_DEMO_ACCOUNTS` | `false` |
| `SIGNUP_ENABLED` | `true` |
| `PUBLIC_APP_URL` | `https://hire-rightt.vercel.app` |
| `INVITE_JOIN_WINDOW_MINUTES` | `5` |
| `SMTP_HOST` | `smtp.sendgrid.net` |
| `SMTP_PORT` | `587` |
| `SMTP_SECURE` | `false` |
| `SMTP_USER` | `apikey` |

## Secrets (you fill in)

| Key | Value |
|-----|--------|
| `DATABASE_URL` | Your Neon PostgreSQL connection string (same as local `.env`) |
| `SESSION_SECRET` | 32+ random characters (keep existing if already set) |
| `GEMINI_API_KEY` | Your Google AI Studio key |
| `SMTP_PASS` | SendGrid API key (starts with `SG.`) |
| `SMTP_FROM` | Verified sender, e.g. `HireRight <hello@yourdomain.com>` |

## After manual deploy

```bash
curl "https://hireright-backend-ykln.onrender.com/api/mail/status"
curl "https://hireright-backend-ykln.onrender.com/api/mail/status?verify=1"
```

Expected (after latest API deploy):

```json
{
  "smtpConfigured": true,
  "smtpPassSet": true,
  "smtpFrom": "HireRight <your-verified@email.com>",
  "publicAppUrl": "https://hire-rightt.vercel.app",
  "verify": { "ok": true }
}
```

Local test (repo root, after filling `.env`):

```bash
npm run mail:test
MAIL_TEST_TO=your@email.com npm run mail:test
```

## SendGrid reminder

1. Create API key: SendGrid → Settings → API Keys.  
2. Verify sender: Settings → Sender Authentication (Single Sender or domain).  
3. `SMTP_FROM` email must match that verified sender.
