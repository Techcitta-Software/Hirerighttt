import { useCallback, useEffect, useMemo, useState } from 'react'
import type { EmployerApplicant } from '../../lib/store'
import { fetchInviteStatuses, type ActiveInterview, type InviteStatus } from '../../lib/vendorApi'

/** "Fri 27 Nov, 10:00 am" in the recruiter's own time zone. */
export function formatSlot(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

/** One short line: "Invite sent", "Link opened", "Booked for Fri 27 Nov, 10:00 am · reminder due", … */
export function inviteStatusText(invite: Pick<InviteStatus, 'state' | 'scheduledStart' | 'reminderDue'>): string {
  switch (invite.state) {
    case 'booked': {
      const when = formatSlot(invite.scheduledStart)
      return `${when ? `Booked for ${when}` : 'Booked'}${invite.reminderDue ? ' · reminder due' : ''}`
    }
    case 'opened':
      return 'Link opened'
    case 'started':
      return 'Interview started'
    case 'completed':
      return 'Interview completed'
    case 'expired':
      return 'Invite expired'
    default:
      return 'Invite sent'
  }
}

/** Tone for the status text: waiting states are neutral, expired is a warning. */
export function inviteTone(state: InviteStatus['state']): 'neutral' | 'good' | 'warn' {
  if (state === 'expired') return 'warn'
  if (state === 'completed' || state === 'started' || state === 'booked') return 'good'
  return 'neutral'
}

export type InviteIndex = {
  /** Latest invite for an applicant (by application id, then by e-mail for the same job or any job). */
  forApplicant: (a: Pick<EmployerApplicant, 'id' | 'candidateEmail' | 'jobId'>) => InviteStatus | null
  /** True while one of this applicant's interviews is running. */
  inProgress: (a: Pick<EmployerApplicant, 'id' | 'candidateEmail' | 'jobId'>) => boolean
  /** Invites that match none of `applicants` (people invited by e-mail who have not applied). */
  unmatched: (applicants: Pick<EmployerApplicant, 'id' | 'candidateEmail' | 'jobId'>[]) => InviteStatus[]
}

/** Pure lookup over the invite list (newest first, as the API returns it). */
export function indexInvites(invites: readonly InviteStatus[], active: readonly ActiveInterview[] = []): InviteIndex {
  const byApp = new Map<string, InviteStatus>()
  const byEmailJob = new Map<string, InviteStatus>()
  const byEmail = new Map<string, InviteStatus>()
  for (const inv of invites) {
    const email = (inv.candidateEmail || '').toLowerCase()
    if (inv.applicationId && !byApp.has(inv.applicationId)) byApp.set(inv.applicationId, inv)
    if (email && !byEmailJob.has(`${email}|${inv.jobId ?? ''}`)) byEmailJob.set(`${email}|${inv.jobId ?? ''}`, inv)
    if (email && !byEmail.has(email)) byEmail.set(email, inv)
  }
  const forApplicant: InviteIndex['forApplicant'] = (a) => {
    const email = (a.candidateEmail || '').toLowerCase()
    return (
      byApp.get(a.id) ??
      (email ? (byEmailJob.get(`${email}|${a.jobId ?? ''}`) ?? (a.jobId ? byEmailJob.get(`${email}|`) : undefined)) : undefined) ??
      null
    )
  }
  const inProgress: InviteIndex['inProgress'] = (a) => {
    const email = (a.candidateEmail || '').toLowerCase()
    if (active.some((s) => (s.applicationId && s.applicationId === a.id) || (email && s.candidateEmail === email && (!s.jobId || !a.jobId || s.jobId === a.jobId)))) {
      return true
    }
    return forApplicant(a)?.state === 'started'
  }
  const unmatched: InviteIndex['unmatched'] = (applicants) => {
    const apps = new Set(applicants.map((a) => a.id))
    const emails = new Set(applicants.map((a) => (a.candidateEmail || '').toLowerCase()).filter(Boolean))
    const seen = new Set<string>()
    return invites.filter((inv) => {
      const email = (inv.candidateEmail || '').toLowerCase()
      if ((inv.applicationId && apps.has(inv.applicationId)) || emails.has(email) || seen.has(email)) return false
      seen.add(email)
      return true
    })
  }
  return { forApplicant, inProgress, unmatched }
}

/** Loads the organisation's invite status (one job's when `jobId` is set). Optional decoration: errors are ignored. */
export function useInviteStatus(opts: { enabled: boolean; jobId?: string }) {
  const [invites, setInvites] = useState<InviteStatus[]>([])
  const [active, setActive] = useState<ActiveInterview[]>([])
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion((v) => v + 1), [])
  useEffect(() => {
    if (!opts.enabled) return
    let cancelled = false
    fetchInviteStatuses({ jobId: opts.jobId }, { background: true })
      .then((out) => {
        if (cancelled) return
        setInvites(out.invites ?? [])
        setActive(out.activeInterviews ?? [])
      })
      .catch(() => {
        /* invite status is optional decoration */
      })
    return () => {
      cancelled = true
    }
  }, [opts.enabled, opts.jobId, version])
  const index = useMemo(() => indexInvites(invites, active), [invites, active])
  return { invites, index, refresh }
}
