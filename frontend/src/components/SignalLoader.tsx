import { useEffect, useId } from 'react'
import { holdLoading } from '../lib/loadingTracker'
import styles from './SignalLoader.module.css'

type Props = {
  /** Rendered height in px; width follows the drawing. */
  size?: number
  /** Read by screen readers only — the loader never shows text. */
  label?: string
}

/** Resting heights (0–1) of the seven bars: a speech envelope that peaks in the middle. */
const BARS = [0.34, 0.58, 0.82, 1, 0.74, 0.5, 0.3] as const
const BAR_W = 6
const GAP = 5
const H = 44
const W = BARS.length * BAR_W + (BARS.length - 1) * GAP

/**
 * HireRighttt's loading mark: a voice waveform. The product is a spoken AI interview, so the wait is shown
 * as the sound of one — seven rounded bars in the brand gradient that swell and settle out of phase,
 * like a speaker finding their rhythm. Shown on a light frosted veil (see GlobalLoadingIndicator), never with
 * a text tag.
 */
export function SignalLoader({ size = 56, label = 'Loading' }: Props) {
  const gradientId = `hr-signal-${useId().replace(/:/g, '')}`
  return (
    <span className={styles.wrap} role="status" aria-live="polite">
      <svg
        className={styles.svg}
        height={size}
        width={Math.round((size * W) / H)}
        viewBox={`0 0 ${W} ${H}`}
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2={W} y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--hr-brand-gradient-start, #5046e5)" />
            <stop offset="1" stopColor="var(--hr-brand-gradient-end, #4f95ff)" />
          </linearGradient>
        </defs>
        {BARS.map((level, i) => {
          const h = H * level
          return (
            <rect
              key={i}
              className={styles.bar}
              style={{ ['--hr-bar-delay' as string]: `${i * 0.11}s`, ['--hr-bar-rest' as string]: level }}
              x={i * (BAR_W + GAP)}
              y={(H - h) / 2}
              width={BAR_W}
              height={h}
              rx={BAR_W / 2}
              fill={`url(#${gradientId})`}
            />
          )
        })}
      </svg>
      <span className="ds-sr-only">{label}</span>
    </span>
  )
}

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
