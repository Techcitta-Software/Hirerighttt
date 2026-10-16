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
  const subject = jobTitle
    ? `Your AI interview for ${jobTitle} — ${dateText}`
    : `Your HireRight AI interview — ${dateText}`
  const greeting = candidateName ? `Hi ${candidateName},` : 'Hi,'
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px;color:#0f172a">
      <p>${greeting}</p>
      <p>You are invited to a <strong>15-minute AI video interview</strong>${jobTitle ? ` for <strong>${jobTitle}</strong>` : ''}.</p>
      <p><strong>Scheduled start:</strong> ${dateText} (IST)</p>
      <p>You can join from the <strong>exact start time</strong> for the next <strong>${INVITE_JOIN_WINDOW_MINUTES} minutes</strong> (for example 2:00 AM → join by 2:05 AM).</p>
      <p>At start time, open the link — you will go straight into your AI interview.</p>
      <p style="margin:24px 0">
        <a href="${inviteUrl}" style="background:#6036eb;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700">
          Join your interview
        </a>
      </p>
      <p style="font-size:13px;color:#64748b">Or copy this link: ${inviteUrl}</p>
      <p>— Team HireRight</p>
    </div>`
  const text = `${greeting}\n\nInterview${jobTitle ? ` for ${jobTitle}` : ''} on ${dateText}.\nJoin: ${inviteUrl}\n\n— Team HireRight`
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
