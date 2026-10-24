import { Link, useNavigate } from 'react-router-dom'
import { HrIcon } from '../components/HrIcon'
import styles from './InterviewRetakePricingPage.module.css'

const RETAKE_PRICE_INR = 89

export function InterviewRetakePricingPage() {
  const navigate = useNavigate()

  function startRetakeInterview() {
    sessionStorage.setItem('hireright.retakeAcknowledged', String(Date.now()))
    navigate('/interview')
  }

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <Link to="/dashboard" className={styles.backLink}>
          <HrIcon name="arrow-right" size={16} className={styles.backIcon} />
          Back to dashboard
        </Link>

        <header className={styles.header}>
          <p className={styles.kicker}>Interview retake</p>
          <h1>Improve your score with a fresh AI session</h1>
          <p className={styles.subtitle}>
            Your first HireRighttt interview is included. Each additional full retake refreshes your
            report and match ranking — payment integration coming soon; for now, continue below to
            start your session.
          </p>
        </header>

        <article className={styles.offerCard}>
          <div className={styles.offerTop}>
            <div>
              <h2>Full interview retake</h2>
              <p>New scored session · updated employer report · same role track</p>
            </div>
            <div className={styles.priceBlock}>
              <span className={styles.currency}>₹</span>
              <span className={styles.amount}>{RETAKE_PRICE_INR}</span>
              <span className={styles.per}>one-time</span>
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
              Download an refreshed PDF scorecard
            </li>
          </ul>

          <button type="button" className={styles.payBtn} onClick={startRetakeInterview}>
            Continue — ₹{RETAKE_PRICE_INR} retake
          </button>
          <p className={styles.disclaimer}>
            No payment gateway yet. Tapping continue takes you straight to the interview room.
          </p>
        </article>
      </div>
    </div>
  )
}
