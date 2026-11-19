import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getUser, logout } from '../lib/store'
import { apiLogout } from '../lib/api'
import { supabaseSignOut } from '../lib/supabaseAuth'
import { OPEN_SIGNOUT_EVENT } from '../lib/signOutModal'
import { useDialog } from './useDialog'
import styles from './SignOutModal.module.css'

export function SignOutModal() {
  const [isOpen, setIsOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [userName, setUserName] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    function handleOpen() {
      const user = getUser()
      setUserName(user?.name || '')
      setUserEmail(user?.email || '')
      setSigningOut(false)
      setIsOpen(true)
    }

    window.addEventListener(OPEN_SIGNOUT_EVENT, handleOpen)
    return () => window.removeEventListener(OPEN_SIGNOUT_EVENT, handleOpen)
  }, [])

  const handleCancel = useCallback(() => {
    if (!signingOut) setIsOpen(false)
  }, [signingOut])

  const dialog = useDialog(isOpen, handleCancel)

  async function handleConfirmSignOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await supabaseSignOut()
    } catch (err) {
      console.warn('Supabase sign-out notice:', err)
    }
    try {
      await apiLogout()
    } catch (err) {
      console.warn('API logout notice:', err)
    }
    logout()
    setIsOpen(false)
    setSigningOut(false)
    navigate('/')
  }

  if (!isOpen) return null

  return (
    <div
      className={styles.overlay}
      onClick={handleCancel}
      onKeyDown={dialog.onKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="signout-modal-title"
    >
      <div ref={dialog.ref} tabIndex={-1} className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <h2 id="signout-modal-title" className={styles.title}>
          Sign out?
        </h2>

        <p className={styles.metaText}>
          You’re signed in as{' '}
          <strong className={styles.strongName}>{userName || userEmail || 'your account'}</strong>
          {userEmail && userName ? (
            <>
              <br />
              <span className={styles.emailText}>{userEmail}</span>.{' '}
            </>
          ) : (
            '. '
          )}
          Confirm to end this session.
        </p>

        <div className={styles.buttonGroup}>
          <button type="button" className={styles.cancelBtn} onClick={handleCancel} disabled={signingOut}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.confirmBtn}
            onClick={() => void handleConfirmSignOut()}
            disabled={signingOut}
            aria-busy={signingOut}
            data-autofocus
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>
    </div>
  )
}
