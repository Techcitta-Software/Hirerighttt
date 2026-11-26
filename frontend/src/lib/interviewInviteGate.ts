export type StoredInterviewInvite = {
  token?: string
  scheduledStart: string
  scheduledEnd: string
  jobTitle?: string
  inviteUrl?: string
  serverOffsetMs?: number
}

const INVITE_KEY = 'hireright.interviewInvite'
const CONTEXT_KEY = 'hireright.inviteInterviewContext'
const IMMEDIATE_KEY = 'hireright.interviewImmediate'

/** Copy of the booked slot that a new tab still sees (T1: the lock lived only in sessionStorage). */
export const INVITE_BACKUP_KEY = 'hireright.interviewInvite.backup'

function readInviteBackup(now = Date.now()): StoredInterviewInvite | null {
  try {
    const raw = localStorage.getItem(INVITE_BACKUP_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredInterviewInvite
    const end = new Date(parsed?.scheduledEnd || '').getTime()
    if (!parsed?.scheduledStart || !Number.isFinite(end) || end <= now) {
      localStorage.removeItem(INVITE_BACKUP_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function readStoredInterviewInvite(): StoredInterviewInvite | null {
  try {
    const raw = sessionStorage.getItem(INVITE_KEY)
    if (raw) return JSON.parse(raw) as StoredInterviewInvite
  } catch {
    return null
  }
  // A new tab: a booked slot that has not ended still applies (unless this tab chose "take it now").
  if (isImmediateInterviewAllowed()) return null
  const backup = readInviteBackup()
  if (backup) {
    try {
      sessionStorage.setItem(INVITE_KEY, JSON.stringify(backup))
    } catch {
      /* ignore */
    }
  }
  return backup
}

export function inviteAccessFromStored(
  invite: StoredInterviewInvite | null,
  now = Date.now(),
): { status: 'open' | 'too_early' | 'expired' | 'invalid'; canStart: boolean } | null {
  if (!invite?.scheduledStart || !invite?.scheduledEnd) return null
  const start = new Date(invite.scheduledStart).getTime()
  const end = new Date(invite.scheduledEnd).getTime()
  if (![start, end, now].every(Number.isFinite) || end <= start) return { status: 'invalid', canStart: false }
  now += Number.isFinite(invite.serverOffsetMs) ? invite.serverOffsetMs! : 0
  if (now < start) return { status: 'too_early', canStart: false }
  if (now >= end) return { status: 'expired', canStart: false }
  return { status: 'open', canStart: true }
}

export function isImmediateInterviewAllowed() {
  try {
    return sessionStorage.getItem(IMMEDIATE_KEY) === '1'
  } catch {
    return false
  }
}

export function markImmediateInterview() {
  sessionStorage.setItem(IMMEDIATE_KEY, '1')
  sessionStorage.removeItem(INVITE_KEY)
  try {
    localStorage.removeItem(INVITE_BACKUP_KEY)
  } catch {
    /* ignore */
  }
}

export function clearImmediateInterviewFlag() {
  sessionStorage.removeItem(IMMEDIATE_KEY)
}

/**
 * `survivesNewTab`: a slot the candidate booked for themselves stays locked in every tab until it ends. Recruiter
 * links are not copied (the link itself carries the invite).
 */
export function persistScheduledInvite(payload: StoredInterviewInvite, opts?: { survivesNewTab?: boolean }) {
  sessionStorage.setItem(INVITE_KEY, JSON.stringify(payload))
  if (!opts?.survivesNewTab) return
  try {
    localStorage.setItem(INVITE_BACKUP_KEY, JSON.stringify(payload))
  } catch {
    /* private mode */
  }
}

export function clearStoredInterviewInvite() {
  try {
    sessionStorage.removeItem(INVITE_KEY)
    localStorage.removeItem(INVITE_BACKUP_KEY)
  } catch {
    /* ignore */
  }
}

/** Countdown text for a booked slot ("2 h 05 min", "4:09", "0:00"). */
export function formatSlotCountdown(msLeft: number): string {
  const total = Math.max(0, Math.floor(msLeft / 1000))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (days > 0) return `${days} d ${hours} h`
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, '0')} min`
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** ms until the stored slot opens (server clock when known); null without a booked slot. */
export function msUntilSlotOpens(invite: StoredInterviewInvite | null, now = Date.now()): number | null {
  if (!invite?.scheduledStart) return null
  const start = new Date(invite.scheduledStart).getTime()
  if (!Number.isFinite(start)) return null
  const offset = Number.isFinite(invite.serverOffsetMs) ? invite.serverOffsetMs! : 0
  return start - (now + offset)
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

/**
 * Applies a booked slot the server reported (GET /api/interview/booking or a 409 INTERVIEW_BOOKED) to this tab, so the
 * lobby shows the lock and the countdown even in a new tab. Returns true when a lock was stored.
 */
export function storeBookingLock(
  booking: { token?: string; scheduledStart: string; scheduledEnd: string; jobTitle?: string; inviteUrl?: string; status?: string } | null | undefined,
  serverNow?: string,
  now = Date.now(),
): boolean {
  if (!booking?.scheduledStart || !booking.scheduledEnd || isImmediateInterviewAllowed()) return false
  const server = serverNow ? Date.parse(serverNow) : NaN
  persistScheduledInvite(
    {
      token: booking.token,
      scheduledStart: booking.scheduledStart,
      scheduledEnd: booking.scheduledEnd,
      jobTitle: booking.jobTitle,
      inviteUrl: booking.inviteUrl,
      serverOffsetMs: Number.isFinite(server) ? server - now : undefined,
    },
    { survivesNewTab: true },
  )
  return true
}
