import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { fadeUp } from '../motion/variants'
import styles from './OnboardingExtractModal.module.css'

type Props = {
  open: boolean
  firstName?: string
  onClose: () => void
}

const AUTO_DISMISS_MS = 3200

export function OnboardingExtractModal({ open, firstName, onClose }: Props) {
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(onClose, AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [open, onClose])

  const displayName = firstName?.trim()
  const title = displayName ? `We got you, ${displayName}` : 'We got you'

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className={styles.overlay}
          role="status"
          aria-live="polite"
          aria-labelledby="extract-modal-title"
          variants={fadeUp}
          initial="hidden"
          animate="show"
          exit="hidden"
          onClick={onClose}
        >
          <motion.div
            className={styles.dialog}
            onClick={(event) => event.stopPropagation()}
            initial={{ opacity: 0, scale: 0.97, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ duration: 0.22 }}
          >
            <div className={styles.icon} aria-hidden="true">
              ✓
            </div>
            <h2 id="extract-modal-title">{title}</h2>
            <p className={styles.tagline}>Review or update your details, then continue.</p>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
