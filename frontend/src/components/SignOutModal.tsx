import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { getUser, logout } from '../lib/store'
import { apiLogout } from '../lib/api'
import { supabaseSignOut } from '../lib/supabaseAuth'
import { OPEN_SIGNOUT_EVENT } from '../lib/signOutModal'
import styles from './SignOutModal.module.css'

export function SignOutModal() {
  const [isOpen, setIsOpen] = useState(false)
  const [userName, setUserName] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    function handleOpen() {
      const user = getUser()
      setUserName(user?.name || '')
      setUserEmail(user?.email || '')
      setIsOpen(true)
    }

    window.addEventListener(OPEN_SIGNOUT_EVENT, handleOpen)
    return () => window.removeEventListener(OPEN_SIGNOUT_EVENT, handleOpen)
  }, [])

  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  async function handleConfirmSignOut() {
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
    navigate('/')
  }

  function handleCancel() {
    setIsOpen(false)
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className={styles.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={handleCancel}
          role="dialog"
          aria-modal="true"
          aria-labelledby="signout-modal-title"
        >
          <motion.div
            className={styles.modalCard}
            initial={{ opacity: 0, scale: 0.94, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 12 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className={styles.kicker}>SIGN OUT</span>

            <h2 id="signout-modal-title" className={styles.title}>
              Sign Out?
            </h2>

            <p className={styles.metaText}>
              You&apos;re signed in as{' '}
              <strong className={styles.strongName}>
                {userName || userEmail || 'your account'}
              </strong>
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
              <button
                type="button"
                className={styles.confirmBtn}
                onClick={handleConfirmSignOut}
              >
                Yes, sign me out
              </button>
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={handleCancel}
              >
                Stay signed in
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
