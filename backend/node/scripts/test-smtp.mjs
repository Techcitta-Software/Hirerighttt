/**
 * Verify Gmail SMTP (App Password) and optionally send a test message.
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
      '  Set in repo-root .env:\n' +
      '    SMTP_EMAIL=your@gmail.com\n' +
      '    SMTP_APP_PASSWORD=16_char_app_password\n' +
      '    EMAIL_FROM="HireRight AI <your@gmail.com>"',
  )
  process.exit(1)
}

try {
  await verifySmtpConnection()
  console.log('[mail:test] Gmail SMTP connection verified OK')
} catch (err) {
  console.error('[mail:test] Connection failed:', err instanceof Error ? err.message : err)
  console.error(
    '  Use a Google App Password (myaccount.google.com/apppasswords), not your normal Gmail password.',
  )
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
    subject: 'HireRight Gmail SMTP test',
    html: `<p>If you received this, Gmail SMTP is working for HireRight.</p><p>Time: ${new Date().toISOString()}</p>`,
    text: `HireRight Gmail SMTP test at ${new Date().toISOString()}`,
  })
  console.log('[mail:test] Test email sent:', info.messageId, '→', info.accepted)
} catch (err) {
  console.error('[mail:test] Send failed:', err instanceof Error ? err.message : err)
  process.exit(1)
}
