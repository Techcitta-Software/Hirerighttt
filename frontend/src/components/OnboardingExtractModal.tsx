import { AnimatePresence, motion } from 'framer-motion'
import { fadeUp } from '../motion/variants'
import styles from './OnboardingExtractModal.module.css'

type Props = {
  open: boolean
  firstName?: string
  onClose: () => void
}

export function OnboardingExtractModal({ open, firstName, onClose }: Props) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className={styles.overlay}
          role="dialog"
          aria-modal="true"
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
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
          >
            <div className={styles.icon} aria-hidden="true">
              ✓
            </div>
            <h2 id="extract-modal-title">Extracted all your details</h2>
            <p>
              {firstName
                ? `${firstName}, we filled in your profile from your resume. Tap below to review or continue.`
                : 'We filled in your profile from your resume. Tap below to review or continue.'}
            </p>
            <button type="button" onClick={onClose}>
              Got it
            </button>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
