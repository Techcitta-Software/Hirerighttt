import { useEffect, useId } from 'react'
import { holdLoading } from '../lib/loadingTracker'
import styles from './RisingArrowLoader.module.css'

type Props = {
  /** Rendered width in px; height follows the 220×80 drawing. */
  size?: number
  /** Read by screen readers only — the loader never shows text. */
  label?: string
}

/**
 * HireRighttt's loading mark: a thin blue trace that runs along a flat line, climbs, takes one step down,
 * climbs again and lands on an arrowhead. The front of the line draws in while the tail wipes out behind it,
 * like a monitor sweep. It is shown on a full-screen veil (see GlobalLoadingIndicator), never with a text tag.
 */
export function RisingArrowLoader({ size = 320, label = 'Loading' }: Props) {
  const gradientId = `hr-trace-${useId().replace(/:/g, '')}`
  return (
    <span className={styles.wrap} role="status" aria-live="polite">
      <svg
        className={styles.svg}
        width={size}
        height={Math.round((size * 80) / 220)}
        viewBox="0 0 220 80"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="64" x2="214" y2="8" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#2f7bff" />
            <stop offset="1" stopColor="#8fc0ff" />
          </linearGradient>
        </defs>
        <path
          className={styles.trace}
          d="M6 62 H78 L112 28 L130 44 L176 10"
          pathLength={100}
          stroke={`url(#${gradientId})`}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <g transform="translate(176 10) rotate(-36.5)">
          <polyline
            className={styles.head}
            points="-13,-9 0,0 -13,9"
            stroke="#8fc0ff"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </svg>
      <span className="ds-sr-only">{label}</span>
    </span>
  )
}

/**
 * Placeholder for a page that is still fetching what it needs. It keeps the page's height and asks the one
 * global veil to show, so a page wait and an API wait never stack two veils on top of each other.
 */
export function PageLoader({ label = 'Loading' }: { label?: string }) {
  useEffect(() => holdLoading(), [])
  return (
    <div className={styles.page} role="status" aria-live="polite">
      <span className="ds-sr-only">{label}</span>
    </div>
  )
}
