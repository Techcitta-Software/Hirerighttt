import { randomBytes } from 'node:crypto'
import { sendMail, publicAppOrigin, smtpConfigured } from './mail.mjs'

/** How long after scheduled start the candidate may open the interview (e.g. 2:00 → join until 2:05). */
export const INVITE_JOIN_WINDOW_MINUTES = Math.min(
  30,
  Math.max(1, Number(process.env.INVITE_JOIN_WINDOW_MINUTES || 5)),
)

export function inviteJoinWindowEnd(scheduledStart, joinMinutes = INVITE_JOIN_WINDOW_MINUTES) {
  const start = new Date(scheduledStart)
  return new Date(start.getTime() + joinMinutes * 60 * 1000)
}

export function newInviteToken() {
  return randomBytes(24).toString('hex')
}

/**
 * @param {import('pg').Pool} pool
 */
export async function insertInterviewInvite(pool, row) {
  await pool.query(
    `INSERT INTO interview_invites
      (token, organization_id, application_id, job_id, candidate_email, candidate_name, job_title,
       scheduled_start, scheduled_end, created_by_user_id, email_sent_at, context_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz,$10,$11::timestamptz,$12::jsonb)`,
    [
      row.token,
      row.organizationId,
      row.applicationId || null,
      row.jobId || null,
      row.candidateEmail,
      row.candidateName || null,
      row.jobTitle || null,
      row.scheduledStart,
      row.scheduledEnd,
      row.createdByUserId || null,
      row.emailSentAt || null,
      JSON.stringify(row.contextJson || {}),
    ],
  )
}

export function parseInviteContext(row) {
  const raw = row?.context_json
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(String(raw))
  } catch {
    return {}
  }
}

/**
 * @param {import('pg').Pool} pool
 */
export async function getInterviewInviteByToken(pool, token) {
  const { rows } = await pool.query(`SELECT * FROM interview_invites WHERE token = $1`, [token])
  return rows[0] || null
}

export function inviteAccessState(invite, now = new Date()) {
  const start = new Date(invite.scheduled_start)
  const end = new Date(invite.scheduled_end)
  if (now.getTime() < start.getTime()) {
    return { status: 'too_early', canStart: false, scheduledStart: start, scheduledEnd: end }
  }
  if (now.getTime() > end.getTime()) {
    return { status: 'expired', canStart: false, scheduledStart: start, scheduledEnd: end }
  }
  return { status: 'open', canStart: true, scheduledStart: start, scheduledEnd: end }
}

export function buildInterviewInviteEmail({ candidateName, jobTitle, scheduledStart, inviteUrl }) {
  const start = new Date(scheduledStart)
  const dateText = start.toLocaleString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  })
  const timeOnly = start.toLocaleString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  })
  const dateOnly = start.toLocaleString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  })
  const roleLine = jobTitle ? ` for <strong>${jobTitle}</strong>` : ''
  const subject = jobTitle
    ? `Booking confirmed: AI interview for ${jobTitle} on ${dateOnly} at ${timeOnly} IST`
    : `Booking confirmed: your HireRight AI interview on ${dateOnly} at ${timeOnly} IST`
  const greeting = candidateName ? `Hi ${candidateName},` : 'Hi,'
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px;color:#0f172a;line-height:1.5">
      <p>${greeting}</p>
      <p>Your <strong>AI interview booking</strong> is confirmed. This email is your confirmation for the slot you selected during onboarding.</p>
      <div style="background:#f1f5f9;border-radius:10px;padding:16px 18px;margin:20px 0;border-left:4px solid #6036eb">
        <p style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:0.04em;color:#64748b">Interview slot (IST)</p>
        <p style="margin:0;font-size:18px;font-weight:700">${dateText}</p>
        <p style="margin:8px 0 0;font-size:14px;color:#475569">Duration: ~15 minutes · Join window: ${INVITE_JOIN_WINDOW_MINUTES} minutes after start</p>
      </div>
      <p>You are scheduled for a <strong>15-minute AI video interview</strong>${roleLine}.</p>
      <p>Open the link below at your <strong>scheduled start time</strong> (not before). You may join until <strong>${INVITE_JOIN_WINDOW_MINUTES} minutes</strong> after the start time.</p>
      <p style="margin:24px 0">
        <a href="${inviteUrl}" style="background:#6036eb;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700">
          Join your AI interview
        </a>
      </p>
      <p style="font-size:13px;color:#64748b">Or copy this link: ${inviteUrl}</p>
      <p style="font-size:13px;color:#64748b">If you did not request this booking, you can ignore this email.</p>
      <p>— HireRight AI</p>
    </div>`
  const text = `${greeting}

Your AI interview booking is confirmed.

Slot (IST): ${dateText}
${jobTitle ? `Role: ${jobTitle}\n` : ''}Duration: ~15 minutes. Join within ${INVITE_JOIN_WINDOW_MINUTES} minutes after start.

Join at your scheduled time: ${inviteUrl}

— HireRight AI`
  return { subject, html, text }
}

export async function sendInterviewInviteEmail(payload) {
  if (!smtpConfigured()) {
    const err = new Error('SMTP not configured')
    err.status = 503
    throw err
  }
  const { subject, html, text } = buildInterviewInviteEmail(payload)
  return sendMail({ to: payload.to, subject, html, text })
}

export function invitePublicUrl(token) {
  return `${publicAppOrigin()}/interview/invite/${token}`
}
