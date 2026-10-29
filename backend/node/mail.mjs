import {
  emailFrom,
  mailConfigured,
  mailProvider,
  resendApiKey,
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
    const err = new Error(
      'Mail not configured (set RESEND_API_KEY + EMAIL_FROM on Render, or SMTP_EMAIL + SMTP_APP_PASSWORD for local Gmail).',
    )
    err.status = 503
    throw err
  }
  return verifyMailConnection()
}

/** @param {{ to: string, subject: string, html: string, text?: string }} opts */
export async function sendMail(opts) {
  return sendCandidateEmail(opts)
}

export function publicAppOrigin(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const normalize = (value) => {
    const url = new URL(value);
    const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(url.hostname);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Invalid app origin');
    if (production && (url.protocol !== 'https:' || local)) throw new Error('Production requires a public HTTPS app origin');
    return url.origin;
  };
  const explicit = [env.PUBLIC_APP_URL, env.FRONTEND_URL, env.APP_URL].find(value => value?.trim());
  if (explicit) {
    try { return normalize(explicit.trim()); } catch {
      const err = new Error('Configure PUBLIC_APP_URL with the public app origin (HTTPS in production), without a path, query or fragment.');
      err.status = 503;
      throw err;
    }
  }
  for (const candidate of String(env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)) {
    try { return normalize(candidate); } catch { /* Try the next configured origin. */ }
  }
  if (!production) return 'http://localhost:5173';
  const err = new Error('PUBLIC_APP_URL is required to create working email links in production.');
  err.status = 503;
  throw err;
}
