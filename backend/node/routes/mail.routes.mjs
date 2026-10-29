import { Router } from 'express'
import {
  smtpConfigured,
  smtpConfigSummary,
  verifySmtpConnection,
  publicAppOrigin,
} from '../mail.mjs'
import { INVITE_JOIN_WINDOW_MINUTES } from '../interviewInvites.mjs'

/** @param {ReturnType<import('../server/appContext.mjs').createAppContext>} ctx */
export function createMailRouter(ctx) {
  const router = Router()
  const { json } = ctx

  router.get('/mail/status', async (req, res) => {
    const wantVerify = new URL(req.url || '/', 'http://localhost').searchParams.get('verify') === '1'
    let verify = null
    if (wantVerify && smtpConfigured()) {
      try {
        await verifySmtpConnection()
        verify = { ok: true }
      } catch (err) {
        verify = { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    } else if (wantVerify && !smtpConfigured()) {
      verify = {
        ok: false,
        error: 'Set RESEND_API_KEY + EMAIL_FROM (Render) or SMTP_EMAIL + SMTP_APP_PASSWORD (local)',
      }
    }
    let publicAppUrl = null
    let publicAppUrlError = null
    try { publicAppUrl = publicAppOrigin() } catch (err) { publicAppUrlError = err.message }
    const summary = smtpConfigSummary()
    return json(res, 200, {
      smtpConfigured: smtpConfigured(),
      mailProvider: summary.provider,
      smtpHost: summary.provider === 'gmail-smtp' ? 'smtp.gmail.com' : null,
      smtpUser: summary.email,
      smtpFrom: summary.from,
      smtpPassSet: summary.passSet,
      resendKeySet: summary.resendKeySet,
      publicAppUrl,
      publicAppUrlError,
      inviteJoinWindowMinutes: INVITE_JOIN_WINDOW_MINUTES,
      verify,
    })
  })

  return router
}
