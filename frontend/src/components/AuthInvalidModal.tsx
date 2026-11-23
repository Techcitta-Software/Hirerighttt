import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  AUTH_INVALID_MSG_KEY,
  consumeAuthInvalidMessage,
  OPEN_AUTH_INVALID_EVENT,
} from '../lib/authSession'
import { useDialog } from './useDialog'
import styles from './SignOutModal.module.css'

/** Small modal when stored auth cookies / token fail server verification. */
export function AuthInvalidModal() {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const onAuthScreen = pathname === '/login' || pathname === '/logout'

  useEffect(() => {
    function show(msg: string) {
      if (!msg) return
      if (pathname === '/login' || pathname === '/logout') {
        sessionStorage.removeItem(AUTH_INVALID_MSG_KEY)
        return
      }
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
  }, [pathname])

  // Esc and the primary button lead to login; backdrop clicks are ignored so the message is not skipped by accident.
  const dismiss = useCallback(() => {
    setOpen(false)
    sessionStorage.removeItem(AUTH_INVALID_MSG_KEY)
    navigate('/login', { replace: true })
  }, [navigate])

  const dialog = useDialog(open, dismiss)

  if (!open || onAuthScreen) return null

  return (
    <div
      className={styles.overlay}
      onKeyDown={dialog.onKeyDown}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="auth-invalid-title"
      aria-describedby="auth-invalid-body"
    >
      <div ref={dialog.ref} tabIndex={-1} className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <h2 id="auth-invalid-title" className={styles.title}>
          Please sign in again
        </h2>
        <p id="auth-invalid-body" className={styles.metaText}>
          {message || 'Your session ended or could not be verified. Sign in to pick up where you left off.'}
        </p>
        <div className={styles.buttonGroup}>
          <button type="button" className={styles.confirmBtn} onClick={dismiss} data-autofocus>
            Sign in
          </button>
        </div>
      </div>
    </div>
  )
}
