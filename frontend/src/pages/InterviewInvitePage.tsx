import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { SiteNav } from '../components/SiteNav'
import { SiteFooter } from '../components/SiteFooter'
import { apiFetch } from '../lib/api'
import {
  inviteAccessFromStored,
  persistInviteInterviewContext,
  persistScheduledInvite,
} from '../lib/interviewInviteGate'
import styles from './InterviewInvitePage.module.css'

type InvitePayload = {
  token: string
  candidateEmail: string
  candidateName?: string
  jobTitle?: string
  scheduledStart: string
  scheduledEnd: string
  status: string
  canStart: boolean
  interviewPath: string
  applicationId?: string | null
  jobId?: string | null
  organizationId?: string | null
  jobDescription?: string
  resumeText?: string
  resumeName?: string | null
  roleTrack?: string
  experienceLevel?: string
  company?: string
  primarySkills?: string[]
  atsScore?: number | null
  jdMatchScore?: number | null
  contextSource?: string | null
}

function formatIst(iso: string, opts: Intl.DateTimeFormatOptions) {
  return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', ...opts })
}

export function InterviewInvitePage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [invite, setInvite] = useState<InvitePayload | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => Date.now())
  const autoRedirected = useRef(false)

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!token) return
    void (async () => {
      try {
        const res = await apiFetch(`/api/interview-invites/${encodeURIComponent(token)}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Invite not found')
        setInvite(data.invite as InvitePayload)
        persistScheduledInvite({
          token,
          scheduledStart: data.invite.scheduledStart,
          scheduledEnd: data.invite.scheduledEnd,
          jobTitle: data.invite.jobTitle,
          inviteUrl: window.location.href,
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load invite')
      } finally {
        setLoading(false)
      }
    })()
  }, [token])

  const liveAccess = useMemo(() => {
    if (!invite) return null
    return inviteAccessFromStored(
      {
        scheduledStart: invite.scheduledStart,
        scheduledEnd: invite.scheduledEnd,
      },
      now,
    )
  }, [invite, now])

  const canStart = liveAccess?.canStart ?? invite?.canStart ?? false
  const status = liveAccess?.status ?? invite?.status ?? ''

  const countdown = useMemo(() => {
    if (!invite || canStart) return null
    const start = new Date(invite.scheduledStart).getTime()
    const diff = start - now
    if (diff <= 0) return null
    const h = Math.floor(diff / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    const s = Math.floor((diff % 60000) / 1000)
    return `${h}h ${m}m ${s}s`
  }, [invite, canStart, now])

  function startInterview() {
    if (!invite || !token || !canStart) return
    if (autoRedirected.current) return
    autoRedirected.current = true
    persistScheduledInvite({
      token,
      scheduledStart: invite.scheduledStart,
      scheduledEnd: invite.scheduledEnd,
      jobTitle: invite.jobTitle,
    })
    persistInviteInterviewContext({
      resumeText: invite.resumeText || '',
      jobDescription: invite.jobDescription || '',
      roleTrack: invite.roleTrack || invite.jobTitle || '',
      experienceLevel: invite.experienceLevel || '',
      primarySkills: invite.primarySkills || [],
    })
    if (invite.applicationId && invite.jobId && invite.organizationId) {
      sessionStorage.setItem(
        'hireright.targetJob',
        JSON.stringify({
          title: invite.jobTitle || invite.roleTrack || 'Role',
          company: invite.company || '',
          role: invite.roleTrack || invite.jobTitle || '',
          level: invite.experienceLevel || '1–3 years',
          jd: invite.jobDescription || '',
          jobId: invite.jobId,
          applicationId: invite.applicationId,
          organizationId: invite.organizationId,
          primarySkills: invite.primarySkills || [],
          atsScore: invite.atsScore ?? undefined,
          jdMatchScore: invite.jdMatchScore ?? undefined,
        }),
      )
    } else if (invite.jobDescription?.trim()) {
      sessionStorage.setItem(
        'hireright.targetJob',
        JSON.stringify({
          title: invite.jobTitle || 'AI Interview',
          company: invite.company || '',
          role: invite.roleTrack || invite.jobTitle || '',
          level: invite.experienceLevel || '1–3 years',
          jd: invite.jobDescription,
          primarySkills: invite.primarySkills || [],
        }),
      )
    }
    navigate('/interview', { replace: true })
  }

  useEffect(() => {
    if (!canStart || !invite || !token || loading || error || autoRedirected.current) return
    startInterview()
  }, [canStart, invite, token, loading, error])

  const start = invite ? new Date(invite.scheduledStart) : null
  const end = invite ? new Date(invite.scheduledEnd) : null
  const hasEmployerContext = invite?.contextSource === 'employer' || Boolean(invite?.applicationId)
  const resumeReady = Boolean(invite?.resumeText && invite.resumeText.trim().length > 20)
  const jdReady = Boolean(invite?.jobDescription && invite.jobDescription.trim().length > 20)

  return (
    <div className={styles.page}>
      <SiteNav />
      <main className={styles.main}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>AI interview invitation</p>
          <h1>{invite?.jobTitle || 'Your scheduled interview'}</h1>
          {invite?.company && <p className={styles.sub}>{invite.company}</p>}
        </header>

        {loading && <p className={styles.muted}>Loading…</p>}
        {error && <p className={styles.error}>{error}</p>}

        {invite && start && end && (
          <div className={styles.card}>
            <div className={styles.grid}>
              <div>
                <span className={styles.label}>Candidate</span>
                <p className={styles.value}>
                  {invite.candidateName || 'Candidate'}{' '}
                  <span className={styles.mutedInline}>({invite.candidateEmail})</span>
                </p>
              </div>
              <div>
                <span className={styles.label}>Join window (IST)</span>
                <p className={styles.value}>
                  Opens{' '}
                  {formatIst(invite.scheduledStart, {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  · join by{' '}
                  {formatIst(invite.scheduledEnd, { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>

            <div className={styles.contextRow}>
              <span className={resumeReady ? styles.chipOn : styles.chipOff}>
                Resume context {resumeReady ? 'ready' : 'pending'}
              </span>
              {hasEmployerContext && (
                <span className={jdReady ? styles.chipOn : styles.chipOff}>
                  Job description {jdReady ? 'included' : 'pending'}
                </span>
              )}
            </div>

            {invite.primarySkills && invite.primarySkills.length > 0 && (
              <div className={styles.skills}>
                {invite.primarySkills.slice(0, 8).map((sk) => (
                  <span key={sk} className={styles.skill}>
                    {sk}
                  </span>
                ))}
              </div>
            )}

            {status === 'too_early' && (
              <div className={styles.noticeWarn}>
                <strong>Your interview opens at the exact scheduled time.</strong>
                <p className={styles.mutedInline}>
                  When the countdown hits zero, you will be taken straight into the AI interview.
                </p>
                {countdown && <p className={styles.countdown}>Starts in {countdown}</p>}
              </div>
            )}
            {status === 'expired' && (
              <p className={styles.error}>
                This interview window has ended. Contact your recruiter for a new link.
              </p>
            )}
            {canStart && (
              <>
                <p className={styles.noticeOk}>Your slot is open — Ava will use your resume
                  {hasEmployerContext && jdReady ? ' and this job description' : ''} for personalized questions.</p>
                <button type="button" className={styles.primaryBtn} onClick={startInterview}>
                  Start AI interview
                </button>
              </>
            )}
            {!canStart && status !== 'expired' && (
              <Link to="/login" className={styles.secondaryBtn}>
                Sign in to prepare your profile
              </Link>
            )}
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  )
}
