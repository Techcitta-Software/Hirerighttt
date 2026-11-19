import styles from './InterviewCompletionPanel.module.css'

const SPARK_COUNT = 12

/**
 * Success mark for the end of an interview: a brand disc with a drawn check and, optionally, one short burst of
 * brand-coloured sparks. CSS only, plays once, and is fully static under prefers-reduced-motion. Decorative.
 */
export function CelebrationMark({
  burst = false,
  tone = 'brand',
}: {
  burst?: boolean
  tone?: 'brand' | 'neutral'
}) {
  return (
    <div className={tone === 'neutral' ? `${styles.mark} ${styles.markNeutral}` : styles.mark} aria-hidden="true">
      {burst && tone === 'brand' ? (
        <span className={styles.burst}>
          {Array.from({ length: SPARK_COUNT }, (_, i) => (
            <span key={i} className={styles.spark} />
          ))}
        </span>
      ) : null}
      <span className={styles.disc}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          {tone === 'neutral' ? (
            <path className={styles.checkPath} d="M6 12h12" />
          ) : (
            <path className={styles.checkPath} d="M5 12.5l4.5 4.5L19 7.5" />
          )}
        </svg>
      </span>
    </div>
  )
}
