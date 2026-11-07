import { useEffect, useMemo } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { BrandLogo } from '../components/BrandLogo'
import { goToCandidateDashboardAfterInterview } from '../lib/completeOnboardingAfterInterview'
import { getInterviewResult, getProfile, getUser } from '../lib/store'
import styles from './InterviewCompletePage.module.css'

function formatDate(value: string | undefined): string {
  const d = value ? new Date(value) : new Date()
  const safe = Number.isNaN(d.getTime()) ? new Date() : d
  return safe.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

/** Shown right after an AI interview ends: candidate details + a single Dashboard button. */
export function InterviewCompletePage() {
  const navigate = useNavigate()
  const user = getUser()
  const profile = getProfile()
  const result = useMemo(() => getInterviewResult(), [])

  useEffect(() => {
    document.title = 'Interview complete — HireRighttt'
  }, [])

  if (!result) return <Navigate to="/dashboard" replace />

  const fullName =
    (profile as { fullName?: string; name?: string } | null)?.fullName ||
    user?.name ||
    'Candidate'
  const location = (profile as { location?: string } | null)?.location || ''

  const details: { label: string; value: string }[] = [
    { label: 'Full name', value: fullName },
    { label: 'Email', value: user?.email || '—' },
    { label: 'Phone', value: user?.phone || '—' },
    ...(location ? [{ label: 'Location', value: location }] : []),
    { label: 'Interview role', value: result.role || '—' },
    { label: 'Experience level', value: result.level || '—' },
    { label: 'Completed on', value: formatDate(result.date) },
    {
      label: result.scoring && !result.scoring.reliable ? 'Provisional score' : 'Overall score',
      value: `${Math.round(result.overall)} / 100`,
    },
  ]

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <BrandLogo to="/" size="md" />
      </header>

      <main className={styles.main}>
        <section className={styles.card} aria-labelledby="complete-title">
          <div className={styles.check} aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </div>
          <p className={styles.kicker}>Interview complete</p>
          <h1 id="complete-title" className={styles.title}>
            Thank you, {fullName.split(/\s+/)[0]}
          </h1>
          <p className={styles.lede}>
            Your interview has been submitted. Your full 360° report is ready on your dashboard.
          </p>

          <dl className={styles.details}>
            {details.map((row) => (
              <div key={row.label} className={styles.row}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>

          {result.scoring && !result.scoring.reliable ? (
            <p className={styles.notice} role="status">
              {result.scoring.notice ||
                'The AI evaluator was unavailable, so this score is provisional and will be reviewed.'}
            </p>
          ) : null}

          <button
            type="button"
            className={styles.cta}
            onClick={() => goToCandidateDashboardAfterInterview(navigate)}
          >
            Dashboard
          </button>
          <p className={styles.dispute}>
            Think this score is wrong? <Link to="/contact">Tell us</Link> and we will review it.
          </p>
        </section>
      </main>
    </div>
  )
}
