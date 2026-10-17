import nodemailer from 'nodemailer'

/** SMTP password / SendGrid API key (several .env aliases). */
export function smtpPassword() {
  return (
    process.env.SMTP_PASS?.trim() ||
    process.env.SENDGRID_API_KEY?.trim() ||
    process.env.SMTP_API_KEY?.trim() ||
    ''
  )
}

export function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && smtpPassword())
}

export function smtpConfigSummary() {
  return {
    host: process.env.SMTP_HOST?.trim() || null,
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER?.trim() || null,
    from: process.env.SMTP_FROM?.trim() || null,
    passSet: Boolean(smtpPassword()),
  }
}

/** Verify SendGrid/Gmail SMTP credentials (no email sent). */
export async function verifySmtpConnection() {
  if (!smtpConfigured()) {
    const err = new Error('SMTP is not fully configured (need SMTP_HOST, SMTP_USER, SMTP_PASS).')
    err.status = 503
    throw err
  }
  const transport = createTransport()
  await transport.verify()
  return { ok: true }
}

function createTransport() {
  const host = process.env.SMTP_HOST?.trim()
  const user = process.env.SMTP_USER?.trim()
  const pass = smtpPassword()
  if (!host || !user) {
    const err = new Error('SMTP is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS in .env')
    err.status = 503
    throw err
  }
  const port = Number(process.env.SMTP_PORT || 587)
  const secure = process.env.SMTP_SECURE === 'true' || port === 465
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  })
}

/**
 * @param {{ to: string, subject: string, html: string, text?: string }} opts
 */
export async function sendMail({ to, subject, html, text }) {
  const from =
    process.env.SMTP_FROM?.trim() ||
    `"HireRight" <${process.env.SMTP_USER?.trim() || 'noreply@hireright.local'}>`
  const transport = createTransport()
  const info = await transport.sendMail({
    from,
    to,
    subject,
    html,
    text: text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  })
  return { messageId: info.messageId, accepted: info.accepted }
}

export function publicAppOrigin() {
  const explicit = process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || process.env.APP_URL
  if (explicit?.trim()) return explicit.trim().replace(/\/$/, '')
  const cors = (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',')[0]?.trim()
  return cors || 'http://localhost:5173'
}
