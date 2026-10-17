# SendGrid: fix “550 Sender Identity” (local email not arriving)

Your API key and SMTP settings can be correct and **SendGrid still blocks sends** until the **From** address is verified.

## Symptom

```text
550 The from address does not match a verified Sender Identity
```

`npm run mail:test` shows **connection verified OK** but **Send failed**.

## Fix (about 5 minutes)

1. Log in to [SendGrid](https://app.sendgrid.com).
2. **Settings → Sender Authentication → Verify a Single Sender**.
3. Use the same email you will put in `.env` as `SMTP_FROM` (e.g. your work Gmail or `hello@techcitta.com`).
4. SendGrid sends a **verification email** — open it and click **Verify**.
5. In repo-root `.env`:

   ```env
   SMTP_FROM="HireRight <exact-verified-email@domain.com>"
   ```

6. Test:

   ```bash
   MAIL_TEST_TO=your-inbox@email.com npm run mail:test
   ```

7. Restart backend (`npm run dev:backend` or `npm run dev:all`) and schedule an invite again.

## Local dev

| Variable | Local value |
|----------|-------------|
| `PUBLIC_APP_URL` | `http://localhost:5173` |
| `MAIL_TEST_TO` | Your inbox (optional, for `npm run mail:test`) |

## After domain `hireright.com` is verified

You can use:

```env
SMTP_FROM="HireRight <noreply@hireright.com>"
```

Until then, use the **Single Sender** address you verified in step 3.
