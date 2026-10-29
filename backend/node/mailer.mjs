import nodemailer from 'nodemailer'

/** Google App Password (spaces in .env are stripped). */
export function smtpAppPassword() {
  return (process.env.SMTP_APP_PASSWORD || '').replace(/\s+/g, '').trim()
}

export function smtpEmail() {
  return process.env.SMTP_EMAIL?.trim() || ''
}

export function resendApiKey() {
  return process.env.RESEND_API_KEY?.trim() || ''
}

export function emailFrom() {
  const explicit = process.env.EMAIL_FROM?.trim() || process.env.SMTP_FROM?.trim()
  if (explicit) return explicit
  const user = smtpEmail()
  return user ? `"HireRight AI" <${user}>` : ''
}

/** `resend` (HTTPS) preferred on Render; `gmail-smtp` for local dev. */
export function mailProvider() {
  if (resendApiKey()) return 'resend'
  if (smtpEmail() && smtpAppPassword()) return 'gmail-smtp'
  return null
}

export function mailConfigured() {
  return Boolean(mailProvider())
}

function createGmailTransporter() {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {
      user: smtpEmail(),
      pass: smtpAppPassword(),
    },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  })
}

async function sendViaResend({ to, subject, html, text }) {
  const key = resendApiKey()
  const from = emailFrom()
  if (!from) {
    const err = new Error('EMAIL_FROM is required when using RESEND_API_KEY')
    err.status = 503
    throw err
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg =
      typeof data?.message === 'string'
        ? data.message
        : typeof data?.error === 'string'
          ? data.error
          : `Resend API failed (${res.status})`
    const err = new Error(msg)
    err.status = res.status
    throw err
  }
  return { ok: true, messageId: data.id, accepted: [to], provider: 'resend' }
}

/** Verify mail credentials without sending. */
export async function verifyMailConnection() {
  const provider = mailProvider()
  if (!provider) {
    const err = new Error(
      'Mail not configured (set RESEND_API_KEY or SMTP_EMAIL + SMTP_APP_PASSWORD).',
    )
    err.status = 503
    throw err
  }
  if (provider === 'resend') {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${resendApiKey()}` },
    })
    if (res.status === 401 || res.status === 403) {
      const err = new Error('Invalid RESEND_API_KEY')
      err.status = 503
      throw err
    }
    return { ok: true, provider: 'resend' }
  }
  const transport = createGmailTransporter()
  await transport.verify()
  return { ok: true, provider: 'gmail-smtp' }
}

/**
 * @param {{ to: string, subject: string, html: string, text?: string }} opts
 */
export async function sendCandidateEmail({ to, subject, html, text }) {
  const provider = mailProvider()
  if (!provider) {
    const err = new Error('Missing mail configuration')
    err.status = 503
    throw err
  }
  if (provider === 'resend') {
    return sendViaResend({ to, subject, html, text })
  }
  const transport = createGmailTransporter()
  const info = await transport.sendMail({
    from: emailFrom(),
    to,
    subject,
    text: text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    html,
  })
  return { ok: true, messageId: info.messageId, accepted: info.accepted, provider: 'gmail-smtp' }
}
