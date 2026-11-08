import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { subscribePending } from '../lib/loadingTracker'
import { RisingArrowLoader } from './RisingArrowLoader'
import styles from './GlobalLoadingIndicator.module.css'

/** Sign-in screens show their own button spinner; the live interview room has its own status lines. */
const EXCLUDED = [/^\/login/, /^\/signup/, /^\/organizations\/signup/, /^\/forgot-password/, /^\/reset-password/, /^\/logout/, /^\/interview(\/now)?$/]

/** Quick responses never flash the veil. */
const SHOW_AFTER_MS = 400
/** Once up, stay long enough to read as intentional rather than a flicker. */
const MIN_VISIBLE_MS = 500
/**
 * Long jobs (resume parsing, report generation) show their own progress on the page; after this long the
 * veil steps aside so it never traps someone behind a request that is slow to settle.
 */
const MAX_VISIBLE_MS = 12000

/** Full-screen navy veil with the rising-arrow trace, shown whenever the app waits on the server. */
export function GlobalLoadingIndicator() {
  const { pathname } = useLocation()
  const reduceMotion = useReducedMotion()
  const [pending, setPending] = useState(0)
  const [visible, setVisible] = useState(false)
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => subscribePending(setPending), [])

  useEffect(() => {
    if (pending > 0 && !visible) {
      const t = window.setTimeout(() => setVisible(true), SHOW_AFTER_MS)
      return () => window.clearTimeout(t)
    }
    if (pending === 0 && visible) {
      const t = window.setTimeout(() => {
        setVisible(false)
        setTimedOut(false)
      }, MIN_VISIBLE_MS)
      return () => window.clearTimeout(t)
    }
    return undefined
  }, [pending, visible])

  useEffect(() => {
    if (!visible) return undefined
    const t = window.setTimeout(() => setTimedOut(true), MAX_VISIBLE_MS)
    return () => window.clearTimeout(t)
  }, [visible])

  const show = visible && !timedOut && !EXCLUDED.some((re) => re.test(pathname))
  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          key="veil"
          className={styles.veil}
          data-testid="global-loading"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}
        >
          <RisingArrowLoader label="Loading" />
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
