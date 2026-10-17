import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AUTH_INVALID_MSG_KEY,
  consumeAuthInvalidMessage,
  OPEN_AUTH_INVALID_EVENT,
} from '../lib/authSession'
import styles from './SignOutModal.module.css'

/** Small modal when stored auth cookies / token fail server verification. */
export function AuthInvalidModal() {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    function show(msg: string) {
      if (!msg) return
      setMessage(msg)
      setOpen(true)
    }

    function onEvent(event: Event) {
      const detail = (event as CustomEvent<{ message?: string }>).detail?.message
      show(detail || consumeAuthInvalidMessage() || '')
    }

    window.addEventListener(OPEN_AUTH_INVALID_EVENT, onEvent)
    const initial = consumeAuthInvalidMessage()
    if (initial) show(initial)

    return () => window.removeEventListener(OPEN_AUTH_INVALID_EVENT, onEvent)
  }, [])

  function dismiss() {
    setOpen(false)
    sessionStorage.removeItem(AUTH_INVALID_MSG_KEY)
    navigate('/login', { replace: true })
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={styles.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={dismiss}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="auth-invalid-title"
        >
          <motion.div
            className={styles.modalCard}
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 12 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="auth-invalid-title" className={styles.title}>
              Sign-in not verified
            </h2>
            <p className={styles.metaText}>{message}</p>
            <div className={styles.buttonGroup}>
              <button type="button" className={styles.confirmBtn} onClick={dismiss}>
                Go to login
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
