import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { BrandLogo } from '../components/BrandLogo'
import { CelebrationMark } from '../components/InterviewCompletionPanel'
import {
  goToCandidateDashboardAfterInterview,
  markCandidateOnboardingCompleteAfterInterview,
} from '../lib/completeOnboardingAfterInterview'
import {
  getInterviewFinishJob,
  retryInterviewFinishJob,
  subscribeInterviewFinishJob,
  type InterviewFinishStatus,
} from '../lib/interviewFinishJob'
import { getInterviewResult, getProfile, getUser } from '../lib/store'
import styles from './InterviewCompletePage.module.css'

function formatDate(value: string | undefined): string {
  const d = value ? new Date(value) : new Date()
  const safe = Number.isNaN(d.getTime()) ? new Date() : d
  return safe.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Candidate score bands (same thresholds and labels as the career report). Low bands stay neutral, never red. */
function scoreBand(score: number): { label: string; tone: 'success' | 'warning' | 'neutral' } {
  if (score >= 75) return { label: 'Strong', tone: 'success' }
  if (score >= 50) return { label: 'Moderate', tone: 'warning' }
  if (score >= 25) return { label: 'Developing', tone: 'neutral' }
  return { label: 'Needs work', tone: 'neutral' }
}

/** Shown right after an AI interview ends: a personal congratulations, what happens next, and a single Dashboard button. */
export function InterviewCompletePage() {
  const navigate = useNavigate()
  const user = getUser()
  const profile = getProfile()
  // Scoring keeps running in the background after the interview room closes; this page opens straight away and
  // fills in the score when that job finishes.
  const job = useMemo(() => getInterviewFinishJob(), [])
  const [jobStatus, setJobStatus] = useState<InterviewFinishStatus | null>(() => job?.status ?? null)
  const [jobError, setJobError] = useState(() => job?.error ?? '')
  const scoring = jobStatus === 'pending'
  const scoringFailed = jobStatus === 'failed'
  // While a job is in flight, whatever is stored belongs to an earlier interview — never show it.
  const result = useMemo(() => (scoring || scoringFailed ? null : getInterviewResult()), [scoring, scoringFailed])
  const [opening, setOpening] = useState(false)
  // Filled after mount so screen readers announce the confirmation from the live region.
  const [announced, setAnnounced] = useState(false)

  // Finishing the interview is the last onboarding step. Make sure it is recorded before opening the dashboard,
  // otherwise a refreshed page (or a failed save) bounces the candidate back to the profile wizard.
  async function openDashboard() {
    if (opening) return
    setOpening(true)
    try {
      await markCandidateOnboardingCompleteAfterInterview()
    } catch {
      // the local profile is still marked complete
    }
    goToCandidateDashboardAfterInterview(navigate)
  }

  useEffect(() => {
    document.title = 'Interview complete — HireRighttt'
  }, [])

  useEffect(() => {
    if (!job) return
    setJobStatus(job.status)
    setJobError(job.error)
    return subscribeInterviewFinishJob((next) => {
      if (next !== job) return
      setJobStatus(next.status)
      setJobError(next.error)
    })
  }, [job])

  useEffect(() => {
    const id = window.setTimeout(() => setAnnounced(true), 120)
    return () => window.clearTimeout(id)
  }, [])

  if (!result && !scoring && !scoringFailed) return <Navigate to="/dashboard" replace />

  const fullName =
    (profile as { fullName?: string; name?: string } | null)?.fullName ||
    user?.name ||
    'Candidate'
  const location = (profile as { location?: string } | null)?.location || ''
  const first = fullName === 'Candidate' ? '' : fullName.trim().split(/\s+/)[0] || ''
  const completedOn = formatDate(result?.date || job?.meta.startedAt)
  const interviewRole = result?.role || job?.meta.role || ''
  const interviewLevel = result?.level || job?.meta.level || ''

  const provisional = Boolean(result?.scoring && !result.scoring.reliable)
  const score = result && Number.isFinite(result.overall) ? Math.round(result.overall) : null
  const band = score != null ? scoreBand(score) : null

  const details: { label: string; value: string }[] = [
    { label: 'Full name', value: fullName },
    { label: 'Email', value: user?.email || '—' },
    { label: 'Phone', value: user?.phone || '—' },
    ...(location ? [{ label: 'Location', value: location }] : []),
    { label: 'Interview role', value: interviewRole || '—' },
    { label: 'Experience level', value: interviewLevel || '—' },
    { label: 'Completed on', value: completedOn },
  ]

  const nextSteps: { title: string; body: string; done?: boolean }[] = [
    {
      title: 'Interview submitted',
      body: `Your answers were saved securely on ${completedOn}.`,
      done: true,
    },
    {
      title: scoring || scoringFailed ? 'Your career report is being prepared' : 'Your career report is ready',
      body: 'See your score for each skill, your strengths, and what to work on next.',
    },
    {
      title: 'Explore job matches',
      body: 'Your dashboard now shows roles that match this interview and your profile.',
    },
  ]

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <BrandLogo to="/" size="md" />
      </header>

      <main className={styles.main}>
        <section className={styles.card} aria-labelledby="complete-title">
          <div className={styles.hero}>
            <CelebrationMark burst />
            <h1 id="complete-title" className={styles.title}>
              {first ? `Congratulations, ${first}!` : 'Congratulations!'}
            </h1>
            {/* Visible confirmation; the live region below carries the same words for screen readers. */}
            <p className={styles.status} aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
                <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
              </svg>
              <span>Interview submitted and saved securely</span>
            </p>
            <p className="ds-sr-only" role="status" aria-live="polite">
              {announced ? 'Interview submitted and saved securely.' : ''}
            </p>
            <p className={styles.lede}>
              Thank you for your time and thoughtful answers.{' '}
              {scoring || scoringFailed
                ? 'Your score will appear here in a moment.'
                : 'Your career report is ready on your dashboard.'}
            </p>
          </div>

          <section className={styles.summary} aria-labelledby="summary-title">
            <h2 id="summary-title" className="ds-sr-only">
              Interview summary
            </h2>
            <div className={styles.scoreRow} aria-live="polite" aria-busy={scoring || undefined}>
              <div className={styles.scoreBlock}>
                <span className={styles.scoreLabel}>{provisional ? 'Provisional score' : 'Overall score'}</span>
                <span className={styles.scoreValue}>
                  {score != null ? score : '—'}
                  <span className={styles.scoreMax}>/100</span>
                </span>
              </div>
              {scoring ? (
                <span className="ds-pill ds-pill--neutral">
                  <span className="ds-spinner" aria-hidden="true" />
                  Scoring your answers…
                </span>
              ) : (
                <span className={`ds-pill ds-pill--dot ds-pill--${band ? band.tone : 'neutral'}`}>
                  {band ? band.label : 'Not scored'}
                </span>
              )}
            </div>

            <dl className={styles.details}>
              {details.map((row) => (
                <div key={row.label} className={styles.row}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {scoringFailed ? (
            <div className={styles.notice} role="alert">
              <p className={styles.noticeText}>
                Your answers are saved, but we could not finish scoring them{jobError ? ` (${jobError})` : ''}.
              </p>
              <button type="button" className={styles.noticeAction} onClick={() => retryInterviewFinishJob()}>
                Try again
              </button>
            </div>
          ) : null}

          {provisional ? (
            <p className={styles.notice} role="status">
              {result?.scoring?.notice ||
                'The AI evaluator was unavailable, so this score is provisional and will be reviewed.'}
            </p>
          ) : null}

          <section className={styles.next} aria-labelledby="next-title">
            <h2 id="next-title" className={styles.sectionTitle}>
              What happens next
            </h2>
            <ol className={styles.timeline}>
              {nextSteps.map((step, i) => (
                <li key={step.title} className={step.done ? `${styles.step} ${styles.stepDone}` : styles.step}>
                  <span className={styles.stepMarker} aria-hidden="true">
                    {step.done ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    ) : (
                      i + 1
                    )}
                  </span>
                  <div className={styles.stepBody}>
                    <h3 className={styles.stepTitle}>
                      {step.title}
                      {step.done ? <span className="ds-sr-only"> (done)</span> : null}
                    </h3>
                    <p className={styles.stepText}>{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cta}
              onClick={() => void openDashboard()}
              disabled={opening}
              aria-busy={opening || undefined}
            >
              {opening ? (
                <>
                  <span className="ds-spinner" aria-hidden="true" />
                  Opening your dashboard…
                </>
              ) : (
                <>
                  View dashboard
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </>
              )}
            </button>
            <p className={styles.dispute}>
              Think this score is wrong? <Link to="/contact">Tell us</Link> and we will review it.
            </p>
          </div>
        </section>
      </main>
    </div>
  )
}
