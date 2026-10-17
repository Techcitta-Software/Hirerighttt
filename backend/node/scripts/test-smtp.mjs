/**
 * Verify SendGrid SMTP and optionally send a test message.
 *
 * Repo root:
 *   node backend/node/scripts/test-smtp.mjs
 *   MAIL_TEST_TO=you@example.com node backend/node/scripts/test-smtp.mjs
 */
import { loadEnv } from '../loadEnv.mjs'
import {
  sendMail,
  smtpConfigSummary,
  smtpConfigured,
  verifySmtpConnection,
} from '../mail.mjs'

loadEnv()

const summary = smtpConfigSummary()
console.log('[mail:test] Config:', {
  ...summary,
  passSet: summary.passSet ? 'yes' : 'MISSING',
})

if (!smtpConfigured()) {
  console.error(
    '[mail:test] SMTP not ready.\n' +
      '  Set in repo-root .env (and Render):\n' +
      '    SMTP_HOST=smtp.sendgrid.net\n' +
      '    SMTP_USER=apikey\n' +
      '    SMTP_PASS=SG.your_sendgrid_api_key\n' +
      '    SMTP_FROM="HireRight <verified-sender@yourdomain.com>"\n' +
      '    PUBLIC_APP_URL=https://hire-rightt.vercel.app',
  )
  process.exit(1)
}

try {
  await verifySmtpConnection()
  console.log('[mail:test] SMTP connection verified OK')
} catch (err) {
  console.error('[mail:test] Connection failed:', err instanceof Error ? err.message : err)
  console.error('  Check SMTP_PASS (SendGrid API key) and that the key has Mail Send permission.')
  process.exit(1)
}

const to = process.env.MAIL_TEST_TO?.trim()
if (!to) {
  console.log('[mail:test] Skipping send (set MAIL_TEST_TO=your@email.com to send a test message).')
  process.exit(0)
}

try {
  const info = await sendMail({
    to,
    subject: 'HireRight SMTP test',
    html: `<p>If you received this, SendGrid SMTP is working for HireRight.</p><p>Time: ${new Date().toISOString()}</p>`,
    text: `HireRight SMTP test at ${new Date().toISOString()}`,
  })
  console.log('[mail:test] Test email sent:', info.messageId, '→', info.accepted)
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err)
  console.error('[mail:test] Send failed:', msg)
  if (msg.includes('verified Sender Identity') || msg.includes('550')) {
    console.error(`
  SendGrid blocked the From address. Fix in SendGrid dashboard (not in code):
    1. https://app.sendgrid.com → Settings → Sender Authentication
    2. Verify Single Sender (fastest) OR authenticate domain hireright.com
    3. Complete the email SendGrid sends you (click verify link)
    4. Set SMTP_FROM to that EXACT verified address in .env, e.g.:
         SMTP_FROM="HireRight <you@email.com>"
    5. Restart backend and run: MAIL_TEST_TO=you@email.com npm run mail:test
`)
  }
  process.exit(1)
}
