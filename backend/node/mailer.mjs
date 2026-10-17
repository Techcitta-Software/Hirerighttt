import nodemailer from 'nodemailer'

/** Google App Password (spaces in .env are stripped). */
export function smtpAppPassword() {
  return (process.env.SMTP_APP_PASSWORD || '').replace(/\s+/g, '').trim()
}

export function smtpEmail() {
  return process.env.SMTP_EMAIL?.trim() || ''
}

export function emailFrom() {
  const explicit = process.env.EMAIL_FROM?.trim() || process.env.SMTP_FROM?.trim()
  if (explicit) return explicit
  const user = smtpEmail()
  return user ? `"HireRight AI" <${user}>` : ''
}

export function mailConfigured() {
  return Boolean(smtpEmail() && smtpAppPassword())
}

function createTransporter() {
  if (!mailConfigured()) {
    const err = new Error('Missing SMTP_EMAIL or SMTP_APP_PASSWORD in .env')
    err.status = 503
    throw err
  }
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: smtpEmail(),
      pass: smtpAppPassword(),
    },
  })
}

/** Verify Gmail credentials without sending mail. */
export async function verifyMailConnection() {
  const transport = createTransporter()
  await transport.verify()
  return { ok: true }
}

/**
 * @param {{ to: string, subject: string, html: string, text?: string }} opts
 */
export async function sendCandidateEmail({ to, subject, html, text }) {
  const transport = createTransporter()
  const info = await transport.sendMail({
    from: emailFrom(),
    to,
    subject,
    text: text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    html,
  })
  return { ok: true, messageId: info.messageId, accepted: info.accepted }
}
