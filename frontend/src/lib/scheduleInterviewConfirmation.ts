import { sendInterviewConfirmationEmail } from './api'
import { ensureApiSession } from './apiSession'
import { persistScheduledInvite } from './interviewInviteGate'
import { getPendingJob } from './pendingJobApply'
import { getUser } from './store'
import type { ProfileFormData } from '../data/wizard'

const SENT_FOR_KEY = 'hireright.emailConfirmedFor'

export function parseScheduledFromNotes(notes: string | undefined): Date | null {
  if (!notes?.startsWith('Scheduled: ')) return null
  const d = new Date(notes.slice('Scheduled: '.length).trim())
  return Number.isNaN(d.getTime()) ? null : d
}

function sentForValue(scheduledIso: string) {
  return `${getUser()?.email ?? ''}|${scheduledIso}`
}

export function wasConfirmationEmailSentFor(scheduledIso: string) {
  return localStorage.getItem(SENT_FOR_KEY) === sentForValue(scheduledIso)
}

export function markConfirmationEmailSent(scheduledIso: string) {
  localStorage.setItem(SENT_FOR_KEY, sentForValue(scheduledIso))
}

export type ScheduleEmailResult = {
  emailSent: boolean
  emailError?: string | null
  inviteUrl?: string
  scheduledStart?: string
  scheduledEnd?: string
  token?: string
  skipped?: boolean
}

/** Sends onboarding step-4 confirmation email (idempotent per scheduled slot). */
export async function sendOnboardingConfirmationEmail(
  data: ProfileFormData,
): Promise<ScheduleEmailResult> {
  const scheduledAt = parseScheduledFromNotes(data.interviewNotes)
  if (!scheduledAt) {
    throw new Error('Select a date and time slot before continuing.')
  }
  if (scheduledAt.getTime() <= Date.now()) {
    throw new Error('Pick a future interview time slot.')
  }

  const scheduledIso = scheduledAt.toISOString()
  if (wasConfirmationEmailSentFor(scheduledIso)) {
    return { emailSent: true, skipped: true, scheduledStart: scheduledIso }
  }

  if (!(await ensureApiSession())) {
    throw new Error('Could not connect your account to the server. Log out and sign in again, then retry.')
  }
  const pending = getPendingJob()
  const payload = {
    scheduledStart: scheduledIso,
    durationMinutes: 60,
    jobTitle: pending?.title || 'HireRight AI Interview',
    jobDescription: pending?.jd || '',
    roleTrack: pending?.role || data.currentRole || '',
    experienceLevel: data.totalExperience || pending?.level || '',
    primarySkills: pending?.primarySkills || data.skills?.slice(0, 12) || [],
  }

  const res = await sendInterviewConfirmationEmail(payload)
  if (res.inviteUrl) {
    persistScheduledInvite({
      token: res.token,
      inviteUrl: res.inviteUrl,
      scheduledStart: res.scheduledStart,
      scheduledEnd: res.scheduledEnd,
      jobTitle: payload.jobTitle,
    })
    localStorage.setItem('hireright.lastInviteUrl', res.inviteUrl)
  }
  if (res.emailSent) {
    markConfirmationEmailSent(scheduledIso)
  }
  return res
}
