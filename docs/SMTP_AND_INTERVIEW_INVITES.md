# SMTP + scheduled interview links

## What happens when someone schedules an interview

1. Employer (or candidate wizard) picks a **start date/time**.
2. Backend creates an invite token and stores:
   - **Start** = exact slot (e.g. 2:00 AM IST)
   - **End** = start + **5 minutes** (join deadline, e.g. 2:05 AM)
3. If SMTP is configured, the candidate gets an email with:
   `https://hire-rightt.vercel.app/interview/invite/{token}`
4. **Before start:** link page shows a countdown; interview is locked.
5. **At start:** opening the link (or staying on the page) **redirects straight to `/interview`**.
6. **After the 5-minute window:** link is expired; recruiter must send a new invite.

Interview **length** (15–180 min in the employer modal) is stored for context only; the **join gate** is always the 5-minute window unless you set `INVITE_JOIN_WINDOW_MINUTES`.

## Environment variables

Set these on **Render** (backend service `hireright-backend-ykln`) **and** in repo-root `.env` for local testing.

| Variable | Required | Purpose |
|----------|----------|---------|
| `SMTP_HOST` | Yes (for email) | e.g. `smtp.gmail.com`, `smtp.sendgrid.net` |
| `SMTP_PORT` | Yes | Usually `587` (TLS) or `465` (SSL) |
| `SMTP_USER` | Yes | Gmail address or SendGrid `apikey` |
| `SMTP_PASS` | Yes | Gmail **App Password** or SendGrid API key |
| `SMTP_FROM` | Recommended | `"HireRight <noreply@yourdomain.com>"` |
| `SMTP_SECURE` | Optional | `true` for port 465; default false for 587 |
| `PUBLIC_APP_URL` | **Yes in production** | `https://hire-rightt.vercel.app` — must match live frontend |
| `INVITE_JOIN_WINDOW_MINUTES` | Optional | Default `5` |

Also required for the API (not SMTP): `DATABASE_URL`, `SESSION_SECRET`, `GEMINI_API_KEY`, `CORS_ORIGINS`.

Frontend (Vite, optional for share links in UI):

| Variable | Purpose |
|----------|---------|
| `VITE_PUBLIC_APP_URL` | Same as `PUBLIC_APP_URL` if you build job links client-side |

## Copy-paste template (fill in your values)

```env
# ─── Render + local backend ───
PUBLIC_APP_URL=https://hire-rightt.vercel.app
INVITE_JOIN_WINDOW_MINUTES=5

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your.email@gmail.com
SMTP_PASS=your-16-char-app-password
SMTP_FROM="HireRight <your.email@gmail.com>"
```

## Verify SMTP

After deploy:

```bash
curl https://hireright-backend-ykln.onrender.com/api/mail/status
```

Expect: `"smtpConfigured": true` and `"publicAppUrl": "https://hire-rightt.vercel.app"`.

## Gmail setup (quick)

1. Google Account → Security → 2-Step Verification ON  
2. App passwords → create “Mail” → copy 16-character password → `SMTP_PASS`  
3. `SMTP_USER` = your Gmail address  
4. Redeploy Render after saving env vars  
