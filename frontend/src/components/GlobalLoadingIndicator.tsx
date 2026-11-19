import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { subscribePending } from '../lib/loadingTracker'
import { SignalLoader } from './SignalLoader'
import styles from './GlobalLoadingIndicator.module.css'

/** Sign-in screens show their own button spinner; the live interview room has its own status lines. */
const EXCLUDED = [/^\/login/, /^\/signup/, /^\/organizations\/signup/, /^\/forgot-password/, /^\/reset-password/, /^\/logout/, /^\/interview(\/now)?$/]

/** Instant responses show nothing. */
const BAR_AFTER_MS = 200
/** A wait that is still going after this long gets the full mark on a veil. */
const VEIL_AFTER_MS = 800
/** Once up, stay long enough to read as intentional rather than a flicker. */
const MIN_VISIBLE_MS = 450
/**
 * Long jobs (resume parsing, report generation) show their own progress on the page; after this long the
 * veil steps aside so it never traps someone behind a request that is slow to settle.
 */
const MAX_VISIBLE_MS = 12000

/**
 * Shown whenever the app waits on the server: a thin brand line on top for short waits, then a light veil
 * with the voice-waveform mark if the wait runs long.
 */
export function GlobalLoadingIndicator() {
  const { pathname } = useLocation()
  const [pending, setPending] = useState(0)
  const [barOn, setBarOn] = useState(false)
  const [veilOn, setVeilOn] = useState(false)
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => subscribePending(setPending), [])

  // Top line: appears after a short delay, lingers briefly after the wait ends.
  useEffect(() => {
    if (pending > 0 && !barOn) {
      const t = window.setTimeout(() => setBarOn(true), BAR_AFTER_MS)
      return () => window.clearTimeout(t)
    }
    if (pending === 0 && barOn) {
      const t = window.setTimeout(() => setBarOn(false), MIN_VISIBLE_MS)
      return () => window.clearTimeout(t)
    }
    return undefined
  }, [pending, barOn])

  // Veil: only if the wait is still unresolved after VEIL_AFTER_MS.
  useEffect(() => {
    if (pending > 0 && !veilOn) {
      const t = window.setTimeout(() => setVeilOn(true), VEIL_AFTER_MS)
      return () => window.clearTimeout(t)
    }
    if (pending === 0 && veilOn) {
      const t = window.setTimeout(() => {
        setVeilOn(false)
        setTimedOut(false)
      }, MIN_VISIBLE_MS)
      return () => window.clearTimeout(t)
    }
    return undefined
  }, [pending, veilOn])

  useEffect(() => {
    if (!veilOn) return undefined
    const t = window.setTimeout(() => setTimedOut(true), MAX_VISIBLE_MS)
    return () => window.clearTimeout(t)
  }, [veilOn])

  const allowed = !EXCLUDED.some((re) => re.test(pathname))
  const showBar = barOn && allowed
  const showVeil = veilOn && !timedOut && allowed

  // Both layers fade in with CSS (see the module); reduced motion turns the fade off there.
  return (
    <>
      {showBar ? <div className={styles.bar} data-testid="global-loading-bar" aria-hidden="true" /> : null}
      {showVeil ? (
        <div className={styles.veil} data-testid="global-loading">
          <div className={styles.tile}>
            <SignalLoader label="Loading" />
          </div>
        </div>
      ) : null}
    </>
  )
}
