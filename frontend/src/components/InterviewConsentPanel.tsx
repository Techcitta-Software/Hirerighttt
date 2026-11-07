import { useState } from 'react'
import { Link } from 'react-router-dom'
import { buildInterviewConsent, type InterviewConsent } from '../lib/interviewConsent'
import styles from './InterviewConsentPanel.module.css'

type Props = {
  /** Company the results are shared with, when the interview is for a job application. */
  employerName?: string
  onAccept: (consent: InterviewConsent) => void
}

/** Shown in the waiting room before the camera turns on. Nothing is recorded until the candidate agrees. */
export function InterviewConsentPanel({ employerName, onAccept }: Props) {
  const [agreed, setAgreed] = useState(false)

  return (
    <section className={styles.panel} aria-labelledby="interview-consent-title">
      <h2 id="interview-consent-title" className={styles.title}>
        Before we start: your consent
      </h2>
      <p className={styles.lead}>
        This interview uses your camera and microphone. Please read what happens with your data.
      </p>

      <ul className={styles.list}>
        <li>
          <strong>Video and audio are recorded</strong> for the whole interview and stored securely.
        </li>
        <li>
          <strong>Face tracking</strong> checks that one person is present and facing the screen. It does not
          identify who you are.
        </li>
        <li>
          <strong>AI transcribes and scores your answers.</strong> Your answers are processed by our AI provider to
          create your report.
        </li>
        <li>
          <strong>Who sees it:</strong> you{employerName ? `, and ${employerName} for this job application` : ''}.
          Employers may review the recording and integrity flags.
        </li>
        <li>
          You can leave at any time before or during the interview. To have your recording deleted, contact us.
        </li>
      </ul>

      <label className={styles.agree}>
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>
          I agree to the recording, face tracking and AI scoring described above, as set out in the{' '}
          <Link to="/privacy" target="_blank" rel="noreferrer" className={styles.link}>
            Privacy Policy
          </Link>
          .
        </span>
      </label>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.accept}
          disabled={!agreed}
          onClick={() => onAccept(buildInterviewConsent())}
        >
          I agree, continue to camera check
        </button>
        <Link to="/dashboard" className={styles.decline}>
          Not now
        </Link>
      </div>
    </section>
  )
}
