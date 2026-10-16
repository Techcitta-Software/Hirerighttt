import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { resolvePublicJob } from '../lib/resolvePublicJob'
import { INVITE_ERROR_KEY, setPendingJob } from '../lib/pendingJobApply'
import { getUser } from '../lib/store'
import styles from './JobInviteEntryPage.module.css'

export { INVITE_ERROR_KEY } from '../lib/pendingJobApply'

/**
 * Shared job-link entry: validates the URL, stores the job (JD + skills) for onboarding,
 * then sends candidates to the home page — not a standalone JD details screen.
 */
export function JobInviteEntryPage() {
  const navigate = useNavigate()
  const { code, companySlug } = useParams<{ code: string; companySlug?: string }>()
  const [status, setStatus] = useState('Opening your invitation…')

  useEffect(() => {
    let cancelled = false

    void (async () => {
      if (!code) {
        sessionStorage.setItem(INVITE_ERROR_KEY, 'This invitation link is incomplete.')
        if (!cancelled) navigate('/', { replace: true })
        return
      }

      setStatus('Loading role details…')
      const { job, error } = await resolvePublicJob(code, companySlug)
      if (cancelled) return

      if (!job || error) {
        sessionStorage.setItem(
          INVITE_ERROR_KEY,
          error || 'This job link is invalid or no longer accepting candidates.',
        )
        navigate('/', { replace: true })
        return
      }

      const user = getUser()
      if (user?.role === 'employer') {
        sessionStorage.setItem(
          INVITE_ERROR_KEY,
          'This link is for candidates. Sign out and sign in with a job seeker account to apply.',
        )
        navigate('/', { replace: true })
        return
      }

      const slug = companySlug || job.companySlug || ''
      setPendingJob(job, slug)
      sessionStorage.removeItem(INVITE_ERROR_KEY)
      setStatus('Taking you to HireRight…')
      navigate('/', { replace: true })
    })()

    return () => {
      cancelled = true
    }
  }, [code, companySlug, navigate])

  return (
    <div className={styles.screen} role="status" aria-live="polite">
      <p className={styles.text}>{status}</p>
    </div>
  )
}
