import { useEffect, useMemo, useRef, useState } from 'react'
import { brandedInviteTitle } from '../lib/brandText'
import { moonshineStt } from '../lib/moonshineStt'
import { PageLoader } from '../components/SignalLoader'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { MarketingNavBar } from '../components/MarketingNavBar'
import { MarketingFooter } from '../components/MarketingFooter'
import { getUser } from '../lib/store'
import { rememberInviteReturn } from '../lib/inviteReturn'
import { clearPendingJob } from '../lib/pendingJobApply'
import { interviewDurationMinutes } from '../lib/interviewDuration'
import { apiFetch } from '../lib/api'
import {
  inviteAccessFromStored,
  persistInviteInterviewContext,
  persistScheduledInvite,
} from '../lib/interviewInviteGate'
import { beginImmediateInterviewTest, isImmediateInterviewTestEnabled } from '../lib/interviewTestMode'
import styles from './InterviewInvitePage.module.css'
import { writeTargetJob, clearTargetJob } from '../lib/targetJob'

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

  // The invited candidate is about to start the interview: warm the speech-to-text model.
  useEffect(() => {
    if (isInvitee) moonshineStt.preloadWhenIdle(1500)
  }, [isInvitee])

  // Remember the link so sign-in / sign-up brings the candidate straight back here.
  useEffect(() => {
    if (!token || !invite || signedInEmail) return
    rememberInviteReturn(`/interview/invite/${token}`, invite.candidateEmail)
    // Opening the emailed link while signed out goes straight to login; after sign-in the
    // candidate is brought back here and the interview starts at the scheduled time.
    if (invite.status !== 'expired') {
      navigate(`/login?email=${encodeURIComponent(invite.candidateEmail)}`, {
        replace: true,
        state: { explicitLogin: true },
      })
    }
  }, [token, invite, signedInEmail, navigate])

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
    clearTargetJob()
    if (invite.applicationId && invite.jobId && invite.organizationId) {
      writeTargetJob({
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
        })
    } else if (invite.jobDescription?.trim()) {
      writeTargetJob({
          title: invite.jobTitle || 'AI Interview',
          company: invite.company || '',
          role: invite.roleTrack || invite.jobTitle || '',
          level: invite.experienceLevel || '1–3 years',
          jd: invite.jobDescription,
          primarySkills: invite.primarySkills || [],
        })
    }
    // The invite carries its own job: an older job link stored during sign-up must not replace it.
    if (invite.applicationId || invite.jobDescription?.trim()) clearPendingJob()
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

  const istTime: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }
  const istDay: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }

  return (
    <div className={styles.page}>
      <MarketingNavBar />
      <main className={styles.main}>
        <header className={styles.hero}>
          <h1>{brandedInviteTitle(invite?.jobTitle) || (error && !loading ? 'Invitation not available' : 'Your scheduled interview')}</h1>
          <p className={styles.sub}>AI interview invitation{invite?.company ? ` from ${invite.company}` : ''}</p>
        </header>

        {loading && <PageLoader label="Loading your interview…" />}
        {error && (
          <div className={`ds-alert ds-alert--error ${styles.errorAlert}`} role="alert">
            <p className={styles.alertText}>
              {error}
              {/not found|expired|invalid/i.test(error)
                ? ' Check the link in your invitation email, or ask the employer to send a new one.'
                : ''}
            </p>
            {/not found|expired|invalid/i.test(error) ? (
              // Retrying a link the server does not know does nothing: offer a way out instead.
              <Link to={signedInEmail ? '/dashboard' : '/'} className={styles.secondaryBtn}>
                {signedInEmail ? 'Go to dashboard' : 'Go to home page'}
              </Link>
            ) : (
              <button type="button" className={styles.secondaryBtn} onClick={() => setRetry((value) => value + 1)}>
                Try again
              </button>
            )}
          </div>
        )}

        {invite && start && end && (
          <section className={styles.card} aria-label="Interview details">
            <dl className={styles.details}>
              <div className={styles.detailRow}>
                <dt className={styles.label}>Candidate</dt>
                <dd className={styles.value}>
                  {invite.candidateName || 'Candidate'}
                  <span className={styles.valueMeta}>{invite.candidateEmail}</span>
                </dd>
              </div>
              {invite.company && (
                <div className={styles.detailRow}>
                  <dt className={styles.label}>Company</dt>
                  <dd className={styles.value}>{invite.company}</dd>
                </div>
              )}
              <div className={styles.detailRow}>
                <dt className={styles.label}>{isOpenLink ? 'Link active until' : 'Join window'}</dt>
                <dd className={styles.value}>
                  {isOpenLink ? (
                    <>{formatIst(invite.scheduledEnd, { ...istDay, ...istTime })} IST</>
                  ) : (
                    <>
                      Opens {formatIst(invite.scheduledStart, { ...istDay, ...istTime })} · join by{' '}
                      {formatIst(invite.scheduledEnd, istTime)} IST
                    </>
                  )}
                </dd>
              </div>
              <div className={styles.detailRow}>
                <dt className={styles.label}>Duration</dt>
                <dd className={styles.value}>
                  About {interviewDurationMinutes({ jd: invite.jobDescription, jobId: invite.jobId || undefined }, null, true)}{' '}
                  minutes
                </dd>
              </div>
              <div className={styles.detailRow}>
                <dt className={styles.label}>Interview context</dt>
                <dd className={styles.contextRow}>
                  <span className={resumeReady ? styles.chipOn : styles.chipOff}>
                    Resume context {resumeReady ? 'ready' : 'pending'}
                  </span>
                  {hasEmployerContext && (
                    <span className={jdReady ? styles.chipOn : styles.chipOff}>
                      Job description {jdReady ? 'included' : 'pending'}
                    </span>
                  )}
                </dd>
              </div>
              {invite.primarySkills && invite.primarySkills.length > 0 && (
                <div className={styles.detailRow}>
                  <dt className={styles.label}>Skills covered</dt>
                  <dd className={styles.skills}>
                    {invite.primarySkills.slice(0, 8).map((sk) => (
                      <span key={sk} className={styles.skill}>
                        {sk}
                      </span>
                    ))}
                  </dd>
                </div>
              )}
            </dl>

            <div className={styles.status}>
              {status === 'too_early' && (
                <div className={styles.noticeWarn}>
                  <p className={styles.noticeTitle}>Your interview opens at the exact scheduled time.</p>
                  <p className={styles.noticeText}>
                    When the countdown hits zero, you will be taken straight into the AI interview.
                  </p>
                  {countdown && <p className={styles.countdown}>Starts in {countdown}</p>}
                  {isImmediateInterviewTestEnabled() && (
                    <button
                      type="button"
                      className={`${styles.secondaryBtn} ${styles.noticeAction}`}
                      onClick={() => beginImmediateInterviewTest(navigate)}
                    >
                      Test: start interview now
                    </button>
                  )}
                </div>
              )}
              {(status === 'expired' || status === 'invalid') && !invite.canReschedule && (
                <p className={`ds-alert ds-alert--warning ${styles.alertBlock}`}>
                  This interview window has ended. Contact your recruiter for a new link.
                </p>
              )}
              {isInvitee && invite.canReschedule && (status === 'too_early' || status === 'expired') && (
                <div className={styles.noticePanel}>
                  <p className={styles.noticeTitle}>
                    {status === 'expired' ? 'Missed your slot? Pick a new time.' : 'Need a different time?'}
                  </p>
                  <p className={styles.noticeText}>Choose a new slot; we will email you the updated link details.</p>
                  <div className={styles.rescheduleRow}>
                    <label className="ds-sr-only" htmlFor="invite-new-slot">
                      New interview date and time
                    </label>
                    <input
                      id="invite-new-slot"
                      type="datetime-local"
                      min={minSlot}
                      value={newSlot}
                      onChange={(e) => setNewSlot(e.target.value)}
                      className={styles.input}
                    />
                    <button
                      type="button"
                      className={styles.primaryBtnMd}
                      onClick={() => void reschedule()}
                      disabled={!newSlot || rescheduling}
                      aria-busy={rescheduling || undefined}
                    >
                      {rescheduling ? 'Moving…' : 'Move my interview'}
                    </button>
                  </div>
                  {rescheduleMsg && (
                    <p className={styles.noticeText} role="status">
                      {rescheduleMsg}
                    </p>
                  )}
                </div>
              )}
              {canStart && needsSignIn && (
                <div className={styles.noticePanel}>
                  <p className={styles.noticeTitle}>Sign in to begin.</p>
                  <p className={styles.noticeText}>
                    Use <strong className={styles.email}>{invite.candidateEmail}</strong> so this invitation matches
                    you. Your interview questions are built from your own resume, and you will be brought straight
                    back here.
                  </p>
                  <div className={styles.actions}>
                    <Link
                      to={`/signup?email=${encodeURIComponent(invite.candidateEmail)}`}
                      state={{ from: `/interview/invite/${token}` }}
                      className={styles.secondaryBtn}
                    >
                      Create account
                    </Link>
                    <Link
                      to={`/login?email=${encodeURIComponent(invite.candidateEmail)}`}
                      state={{ explicitLogin: true, from: `/interview/invite/${token}` }}
                      className={styles.primaryBtn}
                    >
                      Sign in
                    </Link>
                  </div>
                </div>
              )}
              {canStart && wrongAccount && (
                <div className={styles.noticeWarn}>
                  <p className={styles.noticeTitle}>This invitation is for {invite.candidateEmail}.</p>
                  <p className={styles.noticeText}>
                    You are signed in as {me?.email}. Sign out and sign in with the invited address to continue.
                  </p>
                  <Link to="/logout" className={`${styles.secondaryBtn} ${styles.noticeAction}`}>
                    Switch account
                  </Link>
                </div>
              )}
              {canStart && isInvitee && (
                <>
                  <p className={styles.noticeOk}>
                    Your interview is open. Ava will use your resume
                    {hasEmployerContext && jdReady ? ' and this job description' : ''} for personalized questions.
                    {!resumeReady ? ' You will be asked to add your resume first.' : ''}
                  </p>
                  <button type="button" className={`${styles.primaryBtn} ${styles.fullBtn}`} onClick={startInterview}>
                    Start AI interview
                  </button>
                </>
              )}
              {!canStart && status !== 'expired' && needsSignIn && (
                <Link
                  to={`/login?email=${encodeURIComponent(invite.candidateEmail)}`}
                  state={{ explicitLogin: true, from: `/interview/invite/${token}` }}
                  className={`${styles.secondaryBtn} ${styles.fullBtn}`}
                >
                  Sign in to prepare your profile
                </Link>
              )}
            </div>
          </section>
        )}
      </main>
      <MarketingFooter />
    </div>
  )
}
