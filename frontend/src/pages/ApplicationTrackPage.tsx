import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { applicationTimeline } from '../lib/applicationTimeline'
import {
  apiErrorStatus,
  apiGetApplication,
  apiListApplications,
  type ApiApplication,
} from '../lib/api'
import { ensureApiSession } from '../lib/apiSession'
import { getApplications } from '../lib/store'
import pageStyles from './AppPages.module.css'
import styles from './ApplicationTrackPage.module.css'

const REMOVED_MESSAGE = 'This job was removed by the employer. You can withdraw this application.'

function formatAppliedDate(value?: string) {
  const date = value ? new Date(value) : null
  return date && Number.isFinite(date.getTime())
    ? date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : null
}

export function ApplicationTrackPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [app, setApp] = useState<ApiApplication | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setApp(null)
      if (!id) {
        if (!cancelled) {
          setError('Application not found.')
          setLoading(false)
        }
        return
      }
      setLoading(true)
      setError('')
      try {
        const sessionOk = await ensureApiSession()
        if (!sessionOk) {
          const local = getApplications().find((row) => row.id === id) ?? null
          if (!cancelled) {
            setApp(local)
            if (!local) setError('Sign in to load this application.')
          }
          return
        }
        try {
          const remote = await apiGetApplication(id)
          if (!cancelled) setApp(remote)
        } catch (err) {
          if (apiErrorStatus(err) !== 404) throw err
          const list = await apiListApplications()
          const found = list.find((row) => row.id === id) ?? null
          if (!cancelled) {
            setApp(found)
            if (!found) setError('Application not found.')
          }
        }
      } catch (err) {
        if (!cancelled) {
          setApp(null)
          setError(err instanceof Error ? err.message : 'Could not load this application.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const removed = app?.jobStatus === 'deleted'
  const steps = app ? applicationTimeline(app) : null
  const appliedLabel = app ? formatAppliedDate(app.appliedAt) ?? '—' : null
  const place = app ? [app.company, app.location].filter(Boolean).join(' · ') : ''

  return (
    <div className={pageStyles.page}>
      <div className={pageStyles.shell}>
        <div className={pageStyles.main}>
          <p className={styles.back}>
            <Link to="/applications">Back to applications</Link>
          </p>
          <header className={pageStyles.head}>
            <div>
              <h1>{app?.title || 'Application'}</h1>
              {app ? (
                <>
                  {place ? <p>{place}</p> : null}
                  <p>Applied {appliedLabel}</p>
                </>
              ) : null}
            </div>
          </header>

          {error ? (
            <div className={`ds-alert ds-alert--error ${pageStyles.pageAlert}`} role="alert">
              {error}
            </div>
          ) : null}

          {loading ? (
            <p className={pageStyles.muted} role="status">
              Loading this application…
            </p>
          ) : app && removed ? (
            <p className={pageStyles.appRowNote} role="status">
              {app.jobDeletedMessage || REMOVED_MESSAGE}
            </p>
          ) : steps ? (
            <section className={styles.card} aria-labelledby="application-progress-title">
              <h2 id="application-progress-title" className={styles.sectionTitle}>
                Progress
              </h2>
              <ol className={styles.steps}>
                {steps.map((step) => (
                  <li
                    key={step.key}
                    className={`${styles.step} ${step.done ? styles.stepDone : ''} ${step.current ? styles.stepCurrent : ''}`}
                    aria-current={step.current ? 'step' : undefined}
                  >
                    <span className={styles.marker} aria-hidden="true" />
                    <span className={styles.label}>
                      {step.label}
                      {step.current ? <span className={styles.now}>Current</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  )
}
