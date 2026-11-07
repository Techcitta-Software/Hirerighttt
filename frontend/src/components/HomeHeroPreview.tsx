import styles from './HomeHeroPreview.module.css'

/**
 * Home hero visual: the product itself, built in HTML (not a picture).
 * Left half of the frame is the AI conversation with Ava (her real opening lines from
 * data/interviewInteractiveFlow.json); the right half is the 360° view it produces, using the
 * six report areas the page already lists. Marked as a sample.
 */
const REPORT_AREAS = [
  'Strengths & potential',
  'Career direction',
  'Skill gap discovery',
  'Communication insights',
  'Job & interview readiness',
  'Personalized action roadmap',
]

export function HomeHeroPreview() {
  return (
    <div className={styles.frame} aria-label="Preview of a HireRighttt conversation and 360° career view (sample)" role="img">
      <div className={styles.chrome} aria-hidden="true">
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.chromeTitle}>Career discovery · 15 min</span>
        <span className={styles.sample}>Sample</span>
      </div>

      <div className={styles.body} aria-hidden="true">
        <div className={styles.chat}>
          <div className={styles.agentRow}>
            <span className={styles.avatar}>A</span>
            <div>
              <p className={styles.agentName}>
                Ava <span className={styles.live}>Live</span>
              </p>
              <p className={styles.bubbleAgent}>Hello Priya. I am Ava. How is your day going so far?</p>
            </div>
          </div>
          <p className={styles.bubbleUser}>Good, thanks. Ready when you are.</p>
          <div className={styles.agentRow}>
            <span className={styles.avatar}>A</span>
            <p className={styles.bubbleAgent}>
              Thank you, Priya. We will start your interview now. I will ask about your background and resume.
            </p>
          </div>
          <div className={styles.listening}>
            <span className={styles.wave}>
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            Listening…
          </div>
        </div>

        <div className={styles.report}>
          <p className={styles.reportTitle}>Your 360° career view</p>
          <ul className={styles.areas}>
            {REPORT_AREAS.map((area, i) => (
              <li key={area} className={styles.area} style={{ ['--i' as string]: i }}>
                <span className={styles.check}>
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
                    <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                {area}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
