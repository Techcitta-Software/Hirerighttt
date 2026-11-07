import styles from './InterviewWatermark.module.css'

type Props = {
  /** Shown on every tile so a photo or screenshot of the screen can be traced back to this session. */
  label: string
}

/** Faint, non-interactive tiled label over the locked interview room. It deters photographing the screen. */
export function InterviewWatermark({ label }: Props) {
  const text = label.trim().slice(0, 60)
  if (!text) return null
  const tiles = Array.from({ length: 48 }, (_, i) => i)
  return (
    <div className={styles.layer} aria-hidden="true">
      {tiles.map((i) => (
        <span key={i} className={styles.tile}>
          {text}
        </span>
      ))}
    </div>
  )
}
