import { useEffect } from 'react'
import { holdLoading } from '../lib/loadingTracker'
import styles from './SignalLoader.module.css'

type Props = {
  /** Rendered size in px (width & height). Defaults to 56. */
  size?: number
  /** Color of the spinner spokes. Defaults to brand electric blue (#015bf5). */
  color?: string
  /** Read by screen readers only — the loader never shows text. */
  label?: string
  /** Additional CSS class */
  className?: string
}

const COUNT_BARS = 16
const SPOKES = Array.from({ length: COUNT_BARS }, (_, i) => i)

/**
 * Classic radial spinner: 16 rounded spokes radiating in a circle with a rotating fade,
 * in vivid electric blue (#015bf5) exactly matching the reference design.
 */
export function ClassicSpinner({
  size = 56,
  color = 'var(--hr-brand-solid, #015bf5)',
  label = 'Loading',
  className = '',
}: Props) {
  return (
    <span
      className={`${styles.wrap} ${className}`.trim()}
      role="status"
      aria-live="polite"
      style={{ width: size, height: size }}
    >
      <svg
        className={styles.svg}
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        {SPOKES.map((i) => {
          const angle = (360 / COUNT_BARS) * i
          // Negative delay so the wave starts immediately with spoke 0 at full opacity
          const delay = (((i / COUNT_BARS) - 1) * 0.96).toFixed(4)
          const baseOpacity = Math.max(0.08, 1 - (i / COUNT_BARS) * 0.92).toFixed(2)
          return (
            <line
              key={i}
              className={styles.spoke}
              x1="50"
              y1="7"
              x2="50"
              y2="23"
              stroke={color}
              strokeWidth="6.5"
              strokeLinecap="round"
              transform={`rotate(${angle} 50 50)`}
              style={{
                ['--spoke-delay' as string]: `${delay}s`,
                ['--spoke-base-opacity' as string]: baseOpacity,
                opacity: baseOpacity,
              }}
            />
          )
        })}
      </svg>
      <span className="ds-sr-only">{label}</span>
    </span>
  )
}

/**
 * SignalLoader renders the Classic Spinner loading effect across the app.
 */
export const SignalLoader = ClassicSpinner

/**
 * Placeholder for a page that is still fetching what it needs. It keeps the page's height and asks the one
 * global veil to show, so a page wait and an API wait never stack two loaders on top of each other.
 */
export function PageLoader({ label = 'Loading' }: { label?: string }) {
  useEffect(() => holdLoading(), [])
  return (
    <div className={styles.page} role="status" aria-live="polite">
      <span className="ds-sr-only">{label}</span>
    </div>
  )
}
