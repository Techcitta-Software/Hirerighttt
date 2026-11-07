import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { firstName, getUser } from '../lib/store'
import { openSignOutModal } from '../lib/signOutModal'
import { easeOut } from '../motion/variants'
import { BrandLogo } from './BrandLogo'
import styles from './TopBar.module.css'

interface TopBarProps {
  userName?: string
}

export function TopBar({ userName }: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [name, setName] = useState(() => userName ?? firstName())
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    setName(userName ?? firstName())
  }, [userName])

  useEffect(() => {
    function onDoc(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function go(path: string) {
    setMenuOpen(false)
    navigate(path)
  }

  function signOut() {
    setMenuOpen(false)
    openSignOutModal()
  }

  const currentUser = getUser()
  const displayName = currentUser?.name ?? name
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?'

  return (
    <motion.div
      className={styles.topbar}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: easeOut }}
    >
      <span className={styles.mobileBrand}>
        <BrandLogo to="/" size="sm" />
      </span>
      <motion.div
        className={styles.safe}
        whileHover={{ scale: 1.01 }}
        transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      >
        <span className={styles.shield} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M12 3L5 6.5V11.5C5 16 8.2 19.8 12 21C15.8 19.8 19 16 19 11.5V6.5L12 3Z"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
            />
            <path
              d="M9.5 12L11.2 13.7L14.8 10"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        Your data is safe with us
      </motion.div>

      <div className={styles.userWrap} ref={ref}>
        <motion.button
          type="button"
          className={styles.userBtn}
          onClick={() => setMenuOpen((prev) => !prev)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
        >
          <span className={styles.avatar} aria-hidden="true">
            {initials}
          </span>
          <span>Hi, {name}</span>
          <motion.svg
            className={`${styles.chevron} ${menuOpen ? styles.open : ''}`}
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
            animate={{ rotate: menuOpen ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <path
              d="M5 7.5L10 12.5L15 7.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </motion.svg>
        </motion.button>

        <AnimatePresence>
          {menuOpen && (
            <motion.div
              className={styles.menu}
              role="menu"
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.15, ease: easeOut }}
            >
              <div className={styles.menuHeader}>
                <p className={styles.menuName}>{displayName}</p>
                <p className={styles.menuRole}>
                  {currentUser?.role === 'employer' ? 'Employer' : 'Candidate'}
                </p>
              </div>

              <div className={styles.divider} />

              <motion.button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => go('/profile')}
                whileHover={{ x: 2 }}
                whileTap={{ scale: 0.98 }}
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M10 10a4 4 0 100-8 4 4 0 000 8zm0 2c-4 0-7 2-7 4v1h14v-1c0-2-3-4-7-4z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>View profile</span>
              </motion.button>

              <motion.button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => go('/dashboard')}
                whileHover={{ x: 2 }}
                whileTap={{ scale: 0.98 }}
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M3 4a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm9 0a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V4zm0 8a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4zM3 14a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1v-2z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>Dashboard</span>
              </motion.button>

              <motion.button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => go('/settings')}
                whileHover={{ x: 2 }}
                whileTap={{ scale: 0.98 }}
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.6" />
                  <path
                    d="M10 2v2m0 12v2M2 10h2m12 0h2m-3.3-5.7l-1.4 1.4m-6.6 6.6l-1.4 1.4m0-9.4l1.4 1.4m6.6 6.6l1.4 1.4"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
                <span>Account settings</span>
              </motion.button>

              <div className={styles.divider} />

              <motion.button
                type="button"
                role="menuitem"
                className={`${styles.menuItem} ${styles.danger}`}
                onClick={signOut}
                whileHover={{ x: 2 }}
                whileTap={{ scale: 0.98 }}
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M13 14l4-4-4-4m4 4H7m4 7H5a2 2 0 01-2-2V5a2 2 0 012-2h6"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>Sign out</span>
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
