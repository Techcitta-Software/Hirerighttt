import { randomBytes } from 'node:crypto'
import { sendMail, publicAppOrigin, smtpConfigured } from './mail.mjs'

/** How long after scheduled start the candidate may open the interview (e.g. 2:00 → join until 2:05). */
const configuredJoinMinutes = Number(process.env.INVITE_JOIN_WINDOW_MINUTES || 5);
export const INVITE_JOIN_WINDOW_MINUTES = Number.isFinite(configuredJoinMinutes) ? Math.min(30, Math.max(1, configuredJoinMinutes)) : 5;

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
  if (![start.getTime(), end.getTime(), now.getTime()].every(Number.isFinite) || end <= start) {
    return { status: 'invalid', canStart: false, scheduledStart: null, scheduledEnd: null };
  }
  if (now.getTime() < start.getTime()) {
    return { status: 'too_early', canStart: false, scheduledStart: start, scheduledEnd: end }
  }
  if (now.getTime() >= end.getTime()) {
    return { status: 'expired', canStart: false, scheduledStart: start, scheduledEnd: end }
  }
  return { status: 'open', canStart: true, scheduledStart: start, scheduledEnd: end }
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
export function validateInviteStart(invite, candidateEmail, now = new Date()) {
  if (!invite) return {ok: false, status: 404, error: 'This invitation was not found. Ask for a new link.'};
  if (String(invite.candidate_email).trim().toLowerCase() !== String(candidateEmail).trim().toLowerCase()) return {ok: false, status: 403, error: 'Sign in with the email address that received this invitation.'};
  const access = inviteAccessState(invite, now);
  if (!access.canStart) return {ok: false, status: access.status === 'too_early' ? 409 : 410, error: access.status === 'too_early' ? 'Your interview has not opened yet. Return at the scheduled time.' : 'This invitation has expired or is invalid. Ask for a new link.'};
  return {ok: true};
}
export function buildInterviewInviteEmail({ candidateName, jobTitle, scheduledStart, scheduledEnd, durationMinutes = 15, inviteUrl }) {
  const start = new Date(scheduledStart)
  const end = scheduledEnd ? new Date(scheduledEnd) : inviteJoinWindowEnd(start);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new Error('A valid interview time is required.');
  const url = new URL(inviteUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('A valid interview URL is required.');
  const safeUrl = escapeHtml(url.href);
  const duration = Number.isFinite(Number(durationMinutes)) ? Math.min(180, Math.max(15, Number(durationMinutes))) : 15;
  const joinMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  const joinBy = end.toLocaleString('en-IN', {hour:'2-digit', minute:'2-digit', timeZone:'Asia/Kolkata'});
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
  const roleLine = jobTitle ? ` for <strong>${escapeHtml(jobTitle)}</strong>` : ''
  const subject = jobTitle
    ? `Booking confirmed: AI interview for ${jobTitle} on ${dateOnly} at ${timeOnly} IST`
    : `Booking confirmed: your HireRight AI interview on ${dateOnly} at ${timeOnly} IST`
  const greeting = candidateName ? `Hi ${candidateName},` : 'Hi,'
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px;color:#0f172a;line-height:1.5">
      <p>${escapeHtml(greeting)}</p>
      <p>Your <strong>AI interview booking</strong> is confirmed. Your interview details and personal joining link are below.</p>
      <div style="background:#f1f5f9;border-radius:10px;padding:16px 18px;margin:20px 0;border-left:4px solid #6036eb">
        <p style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:0.04em;color:#64748b">Interview slot (IST)</p>
        <p style="margin:0;font-size:18px;font-weight:700">${dateText}</p>
        <p style="margin:8px 0 0;font-size:14px;color:#475569">Duration: ~${duration} minutes · Join before ${joinBy} IST</p>
      </div>
      <p>You are scheduled for a <strong>${duration}-minute AI video interview</strong>${roleLine}.</p>
      <p>You can open this link now to check your interview details. The interview opens at your scheduled start time. Join before <strong>${joinBy} IST</strong> (${joinMinutes} minutes after the start).</p>
      <p style="margin:24px 0">
        <a href="${safeUrl}" style="background:#6036eb;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700">
          Join your AI interview
        </a>
      </p>
      <p style="font-size:13px;color:#64748b">Or copy this link: ${safeUrl}</p>
      <p style="font-size:13px;color:#64748b">If you did not request this booking, you can ignore this email.</p>
      <p>— HireRight AI</p>
    </div>`
  const text = `${greeting}

Your AI interview booking is confirmed.

Slot (IST): ${dateText}
${jobTitle ? `Role: ${jobTitle}\n` : ''}Duration: ~${duration} minutes. Join before ${joinBy} IST (${joinMinutes} minutes after start).

View your interview details and join at the scheduled time: ${url.href}

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
