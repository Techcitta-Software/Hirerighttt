import styles from './Score.module.css'

type Props = {
  value: number
  /** What the number is, for the tooltip and screen readers. */
  label?: string
  size?: 'sm' | 'lg'
}

/** One score display everywhere (§2.8): number, "/100", then a band dot (green 75+, amber 50+, red below). */
export function Score({ value, label = 'AI interview score', size = 'sm' }: Props) {
  const rounded = Math.round(value)
  const tone = rounded >= 75 ? styles.good : rounded >= 50 ? styles.mid : styles.low
  return (
    <span
      className={`${styles.score} ${size === 'lg' ? styles.lg : ''}`}
      role="img"
      aria-label={`${label}: ${rounded} out of 100`}
      title={label}
    >
      <span className={styles.value}>
        {rounded}
        <span className={styles.max}>/100</span>
      </span>
      <span className={`${styles.dot} ${tone}`} aria-hidden="true" />
    </span>
  )
}
