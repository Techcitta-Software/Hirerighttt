export type StoredInterviewInvite = {
  token?: string
  scheduledStart: string
  scheduledEnd: string
  jobTitle?: string
  inviteUrl?: string
}

const INVITE_KEY = 'hireright.interviewInvite'
const CONTEXT_KEY = 'hireright.inviteInterviewContext'
const IMMEDIATE_KEY = 'hireright.interviewImmediate'

export function readStoredInterviewInvite(): StoredInterviewInvite | null {
  try {
    const raw = sessionStorage.getItem(INVITE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as StoredInterviewInvite
  } catch {
    return null
  }
}

export function inviteAccessFromStored(
  invite: StoredInterviewInvite | null,
  now = Date.now(),
): { status: 'open' | 'too_early' | 'expired'; canStart: boolean } | null {
  if (!invite?.scheduledStart || !invite?.scheduledEnd) return null
  const start = new Date(invite.scheduledStart).getTime()
  const end = new Date(invite.scheduledEnd).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  if (now < start) return { status: 'too_early', canStart: false }
  if (now > end) return { status: 'expired', canStart: false }
  return { status: 'open', canStart: true }
}

export function isImmediateInterviewAllowed() {
  return sessionStorage.getItem(IMMEDIATE_KEY) === '1'
}

export function markImmediateInterview() {
  sessionStorage.setItem(IMMEDIATE_KEY, '1')
  sessionStorage.removeItem(INVITE_KEY)
}

export function clearImmediateInterviewFlag() {
  sessionStorage.removeItem(IMMEDIATE_KEY)
}

export function persistScheduledInvite(payload: StoredInterviewInvite) {
  sessionStorage.setItem(INVITE_KEY, JSON.stringify(payload))
}

export function persistInviteInterviewContext(ctx: Record<string, unknown>) {
  sessionStorage.setItem(CONTEXT_KEY, JSON.stringify(ctx))
}

export function readInviteInterviewContext(): {
  resumeText?: string
  jobDescription?: string
  roleTrack?: string
  experienceLevel?: string
  primarySkills?: string[]
} | null {
  try {
    const raw = sessionStorage.getItem(CONTEXT_KEY)
    if (!raw) return null
    return JSON.parse(raw) as ReturnType<typeof readInviteInterviewContext>
  } catch {
    return null
  }
}

export function clearInviteInterviewContext() {
  sessionStorage.removeItem(CONTEXT_KEY)
}
