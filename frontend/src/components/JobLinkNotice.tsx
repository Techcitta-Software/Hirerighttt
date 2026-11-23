import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getPendingJob, INVITE_ERROR_KEY, type PendingJob } from '../lib/pendingJobApply'
import { getUser } from '../lib/store'
import styles from './JobLinkNotice.module.css'

function readInviteError(): string {
  try {
    return sessionStorage.getItem(INVITE_ERROR_KEY) || ''
  } catch {
    return ''
  }
}

/**
 * Shown on the home page after a recruiter job link (/jobs/:company/:code) sent the candidate here: either the role
 * they are applying to (with the next step) or why the link did not work. Before this, both were stored and never
 * shown, so a candidate landed on the generic home page with no idea what happened.
 */
export function JobLinkNotice() {
  const [error, setError] = useState(readInviteError)
  const [job] = useState<PendingJob | null>(() => (readInviteError() ? null : getPendingJob()))
  const user = getUser()

  useEffect(() => {
    if (!error) return
    try {
      sessionStorage.removeItem(INVITE_ERROR_KEY)  // shown once
    } catch {
      /* ignore */
    }
  }, [error])

  if (error) {
    return (
      <div className={`ds-alert ds-alert--error ${styles.notice}`} role="alert">
        <p className={styles.text}>{error}</p>
        <button type="button" className={styles.dismiss} onClick={() => setError('')} aria-label="Dismiss">
          ×
        </button>
      </div>
    )
  }
  if (!job || user?.role === 'employer') return null

  const applyPath = `/apply/${encodeURIComponent(job.companySlug || 'job')}/${encodeURIComponent(job.shareableCode)}`
  return (
    <div className={`ds-alert ds-alert--info ${styles.notice}`} role="status">
      <p className={styles.text}>
        You are applying for <strong>{job.title}</strong>
        {job.company ? ` at ${job.company}` : ''}.{' '}
        {user ? 'Continue to finish your application.' : 'Create a free account to upload your résumé and take the AI interview.'}
      </p>
      <span className={styles.actions}>
        {user ? (
          <Link to={applyPath} className="ds-btn ds-btn--primary ds-btn--sm">
            Continue application
          </Link>
        ) : (
          <>
            <Link to="/login" state={{ explicitLogin: true }} className="ds-btn ds-btn--ghost ds-btn--sm">
              Log in
            </Link>
            <Link to="/signup" state={{ explicitSignup: true }} className="ds-btn ds-btn--primary ds-btn--sm">
              Create account
            </Link>
          </>
        )}
      </span>
    </div>
  )
}
