import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { HrIcon } from '../components/HrIcon'
import { ensureApiSession } from '../lib/apiSession'
import { fetchRetakeStatus, payForRetake, retakeActionFor, type RetakeStatus } from '../lib/retakePayment'
import { accountDisplayName, getUser } from '../lib/store'
import styles from './InterviewRetakePricingPage.module.css'

const DEFAULT_RETAKE_PRICE_INR = 89

export function InterviewRetakePricingPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<RetakeStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await ensureApiSession()
        const next = await fetchRetakeStatus()
        if (!cancelled) setStatus(next)
      } catch {
        // No status (e.g. server without a database): the interview start decides.
      } finally {
        if (!cancelled) setStatusLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const price = status?.priceInr ?? DEFAULT_RETAKE_PRICE_INR
  const action = retakeActionFor(status)

  function startRetakeInterview() {
    sessionStorage.setItem('hireright.retakeAcknowledged', String(Date.now()))
    navigate('/interview')
  }

  async function handlePrimary() {
    if (paying || statusLoading) return
    setError('')
    if (action === 'start-free' || action === 'start-credit') {
      startRetakeInterview()
      return
    }
    if (action !== 'pay') return
    setPaying(true)
    try {
      const user = getUser()
      const next = await payForRetake({ name: accountDisplayName(user), email: user?.email, contact: user?.phone })
      setStatus(next)
      startRetakeInterview()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The payment did not go through. Try again.')
    } finally {
      setPaying(false)
    }
  }

  const buttonLabel = statusLoading
    ? 'Checking your interviews…'
    : paying
      ? 'Opening secure payment…'
      : action === 'start-free'
        ? 'Start your interview'
        : action === 'start-credit'
          ? 'Start your retake (already paid)'
          : action === 'pay'
            ? `Pay ₹${price} and start retake`
            : 'Retakes unavailable'

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <Link to="/dashboard" className={styles.backLink}>
          <HrIcon name="arrow-right" size={16} className={styles.backIcon} />
          Back to dashboard
        </Link>

        <header className={styles.header}>
          <h1>Improve your score with a fresh AI session</h1>
          <p className={styles.subtitle}>
            Your first HireRighttt interview is included. Each additional full retake refreshes your report and
            match ranking. Interviews for an employer&apos;s job are always free.
          </p>
        </header>

        <article className={styles.offerCard}>
          <div className={styles.offerTop}>
            <div>
              <h2>Full interview retake</h2>
              <p>New scored session · updated employer report · same role track</p>
            </div>
            {/* The price must agree with the button below: a free or already-paid retake never shows "₹89 one-time". */}
            <div className={styles.priceBlock}>
              {action === 'start-free' ? (
                <>
                  <span className={styles.amount}>Free</span>
                  <span className={styles.per}>this time</span>
                </>
              ) : (
                <>
                  <span className={styles.currency}>₹</span>
                  <span className={styles.amount}>{price}</span>
                  <span className={styles.per}>{action === 'start-credit' ? 'already paid' : 'one-time'}</span>
                </>
              )}
            </div>
          </div>

          <ul className={styles.featureList}>
            <li>
              <HrIcon name="check" size={16} />
              Re-run the full AI interview with updated answers
            </li>
            <li>
              <HrIcon name="check" size={16} />
              Replace your score on applications you send next
            </li>
            <li>
              <HrIcon name="check" size={16} />
              Download a refreshed PDF scorecard
            </li>
          </ul>

          {error ? (
            <p className="ds-alert ds-alert--error" role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="button"
            className={styles.payBtn}
            onClick={() => void handlePrimary()}
            disabled={statusLoading || paying || action === 'unavailable'}
            aria-busy={statusLoading || paying || undefined}
          >
            {buttonLabel}
          </button>
          <p className={styles.disclaimer}>
            {action === 'pay'
              ? 'Secure payment by Razorpay. You are only charged once; the retake credit is used when the interview starts.'
              : action === 'start-credit'
                ? 'You have a paid retake credit. It is used when the interview starts.'
                : action === 'unavailable'
                  ? 'Paid retakes are not available yet. Contact support if you need to retake your interview.'
                  : 'No payment needed for this interview.'}
          </p>
        </article>
      </div>
    </div>
  )
}
