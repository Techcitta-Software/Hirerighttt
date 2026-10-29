import {
  emailFrom,
  mailConfigured,
  sendCandidateEmail,
  smtpAppPassword,
  smtpEmail,
  verifyMailConnection,
} from './mailer.mjs'

export function smtpConfigured() {
  return mailConfigured()
}

export function smtpConfigSummary() {
  const provider = mailProvider()
  return {
    provider: provider || 'none',
    email: smtpEmail() || null,
    from: emailFrom() || null,
    passSet: Boolean(smtpAppPassword()),
    resendKeySet: Boolean(resendApiKey()),
  }
}

export async function verifySmtpConnection() {
  if (!smtpConfigured()) {
    const err = new Error('SMTP is not configured (set SMTP_EMAIL and SMTP_APP_PASSWORD in .env).')
    err.status = 503
    throw err
  }
  return verifyMailConnection()
}

/** @param {{ to: string, subject: string, html: string, text?: string }} opts */
export async function sendMail(opts) {
  return sendCandidateEmail(opts)
}

export function publicAppOrigin() {
  const explicit = process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || process.env.APP_URL
  if (explicit?.trim()) return explicit.trim().replace(/\/$/, '')
  const cors = (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',')[0]?.trim()
  return cors || 'http://localhost:5173'
}
