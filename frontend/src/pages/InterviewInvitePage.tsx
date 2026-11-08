import { useEffect, useMemo, useRef, useState } from 'react'
import { PageLoader } from '../components/RisingArrowLoader'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { MarketingNavBar } from '../components/MarketingNavBar'
import { MarketingFooter } from '../components/MarketingFooter'
import { getUser } from '../lib/store'
import { rememberInviteReturn } from '../lib/inviteReturn'
import { apiFetch } from '../lib/api'
import {
  inviteAccessFromStored,
  persistInviteInterviewContext,
  persistScheduledInvite,
} from '../lib/interviewInviteGate'
import { beginImmediateInterviewTest, isImmediateInterviewTestEnabled } from '../lib/interviewTestMode'
import styles from './InterviewInvitePage.module.css'

type InvitePayload = {
  token: string
  candidateEmail: string
  candidateName?: string
  jobTitle?: string
  scheduledStart: string
  scheduledEnd: string
  serverNow?: string
  status: string
  canStart: boolean
  canReschedule?: boolean
  interviewPath: string
  applicationId?: string | null
  jobId?: string | null
  organizationId?: string | null
  jobDescription?: string
  resumeText?: string
  resumeReady?: boolean
  signedInAsInvitee?: boolean
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
  const [serverOffsetMs, setServerOffsetMs] = useState(0)
  const [retry, setRetry] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const autoRedirected = useRef(false)
  const [newSlot, setNewSlot] = useState('')
  const [rescheduling, setRescheduling] = useState(false)
  const [rescheduleMsg, setRescheduleMsg] = useState('')
  const me = getUser()
  const signedInEmail = me?.email?.trim().toLowerCase() || ''
  const invitedEmail = invite?.candidateEmail?.trim().toLowerCase() || ''
  const isInvitee = Boolean(signedInEmail) && signedInEmail === invitedEmail
  const wrongAccount = Boolean(signedInEmail) && Boolean(invitedEmail) && !isInvitee
  const needsSignIn = Boolean(invite) && !signedInEmail

  // Remember the link so sign-in / sign-up brings the candidate straight back here.
  useEffect(() => {
    if (!token || !invite || signedInEmail) return
    rememberInviteReturn(`/interview/invite/${token}`, invite.candidateEmail)
  }, [token, invite, signedInEmail])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const controller = new AbortController();
    autoRedirected.current = false;
    setInvite(null);
    setLoading(true);
    setError('');
    const refresh = async () => {
      if (!token) { setError('This invitation link is incomplete.'); setLoading(false); return; }
      try {
        const res = await apiFetch(`/api/interview-invites/${encodeURIComponent(token)}`, {signal: controller.signal, cache: 'no-store'});
        const data = await res.json();
        if (!res.ok || !data.invite) throw new Error(data.error || 'Could not load this invitation.');
        if (stopped) return;
        const current = data.invite as InvitePayload;
        const serverTime = Date.parse(current.serverNow || '');
        const offset = Number.isFinite(serverTime) ? serverTime - Date.now() : 0;
        setServerOffsetMs(offset);
        setNow(Date.now());
        setInvite(current);
        setError('');
        persistScheduledInvite({token, scheduledStart: current.scheduledStart, scheduledEnd: current.scheduledEnd, jobTitle: current.jobTitle, inviteUrl: window.location.href, serverOffsetMs: offset});
      } catch (e) {
        if (!stopped) { setError(e instanceof Error ? e.message : 'Could not load invite'); setInvite(null); }
      } finally {
        if (!stopped) { setLoading(false); timer = window.setTimeout(refresh, 15000); }
      }
    };
    void refresh();
    return () => { stopped = true; controller.abort(); window.clearTimeout(timer); };
  }, [token, retry]);

  const liveAccess = useMemo(() => {
    if (!invite) return null
    return inviteAccessFromStored(
      {
        scheduledStart: invite.scheduledStart,
        scheduledEnd: invite.scheduledEnd,
        serverOffsetMs,
      },
      now,
    )
  }, [invite, now, serverOffsetMs])

  const canStart = liveAccess?.canStart ?? invite?.canStart ?? false
  const status = liveAccess?.status ?? invite?.status ?? ''

  const countdown = useMemo(() => {
    if (!invite || canStart) return null
    const start = new Date(invite.scheduledStart).getTime()
    const diff = start - (now + serverOffsetMs)
    if (diff <= 0) return null
    const h = Math.floor(diff / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    const s = Math.floor((diff % 60000) / 1000)
    return `${h}h ${m}m ${s}s`
  }, [invite, canStart, now, serverOffsetMs])

  function startInterview() {
    if (!invite || !token || !canStart || !isInvitee) return
    if (autoRedirected.current) return
    autoRedirected.current = true
    if (!resumeReady) {
      // Questions are built from the resume: add it first, then the wizard returns here.
      rememberInviteReturn(`/interview/invite/${token}`, invite.candidateEmail)
      navigate('/onboarding?step=1', { replace: true })
      return
    }
    persistScheduledInvite({
      token,
      scheduledStart: invite.scheduledStart,
      scheduledEnd: invite.scheduledEnd,
      serverOffsetMs,
      jobTitle: invite.jobTitle,
    })
    persistInviteInterviewContext({
      resumeText: invite.resumeText || '',
      jobDescription: invite.jobDescription || '',
      roleTrack: invite.roleTrack || invite.jobTitle || '',
      experienceLevel: invite.experienceLevel || '',
      primarySkills: invite.primarySkills || [],
    })
    sessionStorage.removeItem('hireright.targetJob')
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
    if (!isInvitee) return
    startInterview()
  }, [canStart, invite, token, loading, error, isInvitee])

  async function reschedule() {
    if (!token || !newSlot) return
    const when = new Date(newSlot)
    if (Number.isNaN(when.getTime())) {
      setRescheduleMsg('Choose a valid date and time.')
      return
    }
    setRescheduling(true)
    setRescheduleMsg('')
    try {
      const res = await apiFetch(`/api/interview-invites/${encodeURIComponent(token)}/reschedule`, {
        method: 'POST',
        body: JSON.stringify({ scheduledStart: when.toISOString() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not move your interview.')
      setRescheduleMsg(
        data.emailSent
          ? 'Your interview has been moved. We emailed you the new time.'
          : 'Your interview has been moved.',
      )
      setNewSlot('')
      setRetry((value) => value + 1)
    } catch (e) {
      setRescheduleMsg(e instanceof Error ? e.message : 'Could not move your interview.')
    } finally {
      setRescheduling(false)
    }
  }

  const minSlot = useMemo(() => {
    const d = new Date(Date.now() + 20 * 60000)
    d.setSeconds(0, 0)
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  }, [])

  const start = invite ? new Date(invite.scheduledStart) : null
  const isOpenLink = invite ? new Date(invite.scheduledEnd).getTime() - new Date(invite.scheduledStart).getTime() > 24 * 3600 * 1000 : false
  const end = invite ? new Date(invite.scheduledEnd) : null
  const hasEmployerContext = invite?.contextSource === 'employer' || Boolean(invite?.applicationId)
  const resumeReady = Boolean(invite?.resumeReady || (invite?.resumeText && invite.resumeText.trim().length > 20))
  const jdReady = Boolean(invite?.jobDescription && invite.jobDescription.trim().length > 20)

  return (
    <div className={styles.page}>
      <MarketingNavBar />
      <main className={styles.main}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>AI interview invitation</p>
          <h1>{invite?.jobTitle || 'Your scheduled interview'}</h1>
          {invite?.company && <p className={styles.sub}>{invite.company}</p>}
        </header>

        {loading && <PageLoader label="Loading your interview…" />}
        {error && <div role="alert"><p className={styles.error}>{error}</p><button type="button" className={styles.secondaryBtn} onClick={() => setRetry(value => value + 1)}>Try again</button></div>}

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
                <span className={styles.label}>{isOpenLink ? 'Link active until (IST)' : 'Join window (IST)'}</span>
                <p className={styles.value}>
                  {isOpenLink ? (
                    formatIst(invite.scheduledEnd, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                  ) : (
                  <>Opens{' '}
                  {formatIst(invite.scheduledStart, {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  · join by{' '}
                  {formatIst(invite.scheduledEnd, { hour: '2-digit', minute: '2-digit' })}</>
                  )}
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
                {isImmediateInterviewTestEnabled() && (
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    style={{ marginTop: '12px' }}
                    onClick={() => beginImmediateInterviewTest(navigate)}
                  >
                    Test: start interview now
                  </button>
                )}
              </div>
            )}
            {(status === 'expired' || status === 'invalid') && !invite.canReschedule && (
              <p className={styles.error}>
                This interview window has ended. Contact your recruiter for a new link.
              </p>
            )}
            {isInvitee && invite.canReschedule && (status === 'too_early' || status === 'expired') && (
              <div className={styles.noticeWarn}>
                <strong>{status === 'expired' ? 'Missed your slot? Pick a new time.' : 'Need a different time?'}</strong>
                <p className={styles.mutedInline}>Choose a new slot; we will email you the updated link details.</p>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
                  <label className="ds-sr-only" htmlFor="invite-new-slot">
                    New interview date and time
                  </label>
                  <input
                    id="invite-new-slot"
                    type="datetime-local"
                    min={minSlot}
                    value={newSlot}
                    onChange={(e) => setNewSlot(e.target.value)}
                    style={{ minHeight: 42, padding: '0 10px', borderRadius: 10, border: '1px solid #d6d7e5' }}
                  />
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={() => void reschedule()}
                    disabled={!newSlot || rescheduling}
                  >
                    {rescheduling ? 'Moving…' : 'Move my interview'}
                  </button>
                </div>
                {rescheduleMsg && (
                  <p className={styles.mutedInline} role="status" style={{ marginTop: 8 }}>
                    {rescheduleMsg}
                  </p>
                )}
              </div>
            )}
            {canStart && needsSignIn && (
              <div className={styles.noticeOk}>
                <strong>Sign in to begin.</strong>
                <p className={styles.mutedInline}>
                  Use <b>{invite.candidateEmail}</b> so this invitation matches you. Your interview questions are built
                  from your own resume, and you will be brought straight back here.
                </p>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
                  <Link
                    to={`/login?email=${encodeURIComponent(invite.candidateEmail)}`}
                    state={{ explicitLogin: true, from: `/interview/invite/${token}` }}
                    className={styles.primaryBtn}
                  >
                    I have an account — sign in
                  </Link>
                  <Link
                    to={`/signup?email=${encodeURIComponent(invite.candidateEmail)}`}
                    state={{ from: `/interview/invite/${token}` }}
                    className={styles.secondaryBtn}
                  >
                    Create my account
                  </Link>
                </div>
              </div>
            )}
            {canStart && wrongAccount && (
              <div className={styles.noticeWarn}>
                <strong>This invitation is for {invite.candidateEmail}.</strong>
                <p className={styles.mutedInline}>
                  You are signed in as {me?.email}. Sign out and sign in with the invited address to continue.
                </p>
                <Link to="/logout" className={styles.secondaryBtn}>
                  Switch account
                </Link>
              </div>
            )}
            {canStart && isInvitee && (
              <>
                <p className={styles.noticeOk}>
                  Your interview is open — Ava will use your resume
                  {hasEmployerContext && jdReady ? ' and this job description' : ''} for personalized questions.
                  {!resumeReady ? ' You will be asked to add your resume first.' : ''}
                </p>
                <button type="button" className={styles.primaryBtn} onClick={startInterview}>
                  Start AI interview
                </button>
              </>
            )}
            {!canStart && status !== 'expired' && needsSignIn && (
              <Link
                to={`/login?email=${encodeURIComponent(invite.candidateEmail)}`}
                state={{ explicitLogin: true, from: `/interview/invite/${token}` }}
                className={styles.secondaryBtn}
              >
                Sign in to prepare your profile
              </Link>
            )}
          </div>
        )}
      </main>
      <MarketingFooter />
    </div>
  )
}
