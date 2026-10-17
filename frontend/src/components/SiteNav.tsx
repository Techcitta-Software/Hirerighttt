import { useEffect, useState, type MouseEvent } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { handleLoginNavigation } from '../lib/authSession'
import { AnimatePresence, motion } from 'framer-motion'
import { getUser, isLoggedIn, unreadNotificationCount } from '../lib/store'
import { openSignOutModal } from '../lib/signOutModal'
import { BrandLogo } from './BrandLogo'
import styles from './SiteNav.module.css'


const MARKETING_NAV = [
  { to: '/job-seekers', label: 'For Job Seekers' },
  { to: '/why', label: 'Why HireRight' },
  { to: '/solutions', label: 'Solutions' },
  { to: '/resources', label: 'Resources' },
  { to: '/about', label: 'About Us' },
]

const LANDING_NAV = [
  { to: '/jobs', label: 'Find jobs' },
  { to: '/solutions', label: 'For employers' },
  { to: '/how-it-works', label: 'How it works' },
]

const JOBSEEKER_NAV = [{ to: '/jobs', label: 'Jobs' }]

const EMPLOYER_NAV = [
  { to: '/employer/dashboard', label: 'Jobs' },
  { to: '/employer/candidates', label: 'Candidates' },
]

type SiteNavProps = {
  variant?: 'default' | 'minimal' | 'landing' | 'home' | 'light' | 'dark'
  /** Hide sign-out on the logout confirmation screen */
  suppressSignOut?: boolean
}

export function SiteNav({ variant = 'default', suppressSignOut = false }: SiteNavProps = {}) {
  const location = useLocation()
  const navigate = useNavigate()
  const onLogoutRoute = location.pathname === '/logout'
  const hideSignOut = suppressSignOut || onLogoutRoute
  const [open, setOpen] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  const [unread, setUnread] = useState(0)
  const user = getUser()
  const isHome = variant === 'home'

  function onLoginClick(event: MouseEvent) {
    if (!isHome) return
    event.preventDefault()
    setOpen(false)
    void handleLoginNavigation(navigate)
  }

  useEffect(() => {
    function syncAuth() {
      setLoggedIn(isLoggedIn())
      setUnread(unreadNotificationCount())
    }
    syncAuth()
    window.addEventListener('hireright-auth', syncAuth)
    return () => window.removeEventListener('hireright-auth', syncAuth)
  }, [location.pathname])

  function handleLogout() {
    setOpen(false)
    openSignOutModal()
  }

  const isLanding = variant === 'landing'
  const isHomeRoute = location.pathname === '/'
  const showMarketingOnHome = isHome && isHomeRoute

  const primaryNav = showMarketingOnHome
    ? MARKETING_NAV
    : loggedIn
      ? user?.role === 'employer'
        ? EMPLOYER_NAV
        : JOBSEEKER_NAV
      : isLanding
        ? LANDING_NAV
        : MARKETING_NAV

  function navLabel(item: (typeof primaryNav)[number]) {
    if (item.to === '/applications' && unread > 0) {
      return `${item.label} (${unread})`
    }
    return item.label
  }

  const headerClass = [
    styles.navbar,
    variant === 'minimal' && styles.navbarMinimal,
    isLanding && styles.navbarLanding,
    isHome && styles.navbarHome,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <header className={headerClass}>
      <div className={isLanding ? styles.innerLanding : styles.inner}>
        <BrandLogo
          dark={variant === 'dark'}
          onClick={() => setOpen(false)}
          size="md"
          to={
            loggedIn
              ? user?.role === 'employer'
                ? '/employer/dashboard'
                : '/dashboard'
              : '/'
          }
          className={isHomeRoute ? styles.homeLogo : undefined}
        />


        <nav
          className={isLanding ? styles.navPillGroup : styles.navLinks}
          aria-label="Primary"
        >
          {primaryNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isLanding
                  ? isActive
                    ? `${styles.navPillLink} ${styles.navPillActive}`
                    : styles.navPillLink
                  : isActive
                    ? `${styles.navLink} ${styles.active}`
                    : styles.navLink
              }
            >
              {navLabel(item)}
            </NavLink>
          ))}
        </nav>

        <div className={styles.navActions}>
          {loggedIn && !showMarketingOnHome ? (
            <>
              {isLanding && (
                <Link
                  to={user?.role === 'employer' ? '/employer/dashboard' : '/dashboard'}
                  className={styles.landingSolid}
                >
                  Dashboard
                </Link>
              )}
              {!hideSignOut && (
                <button
                  type="button"
                  className={isLanding ? styles.landingOutline : styles.signOutBtn}
                  onClick={handleLogout}
                >
                  Sign out
                </button>
              )}
            </>
          ) : showMarketingOnHome ? (
            loggedIn ? (
              <>
                <Link
                  to={user?.role === 'employer' ? '/employer/dashboard' : '/dashboard'}
                  className={styles.homeSignIn}
                >
                  Dashboard
                </Link>
                <Link to="/interview" className={styles.homeLoginPill}>
                  AI Interview
                </Link>
              </>
            ) : (
              <>
                <Link to="/login" className={styles.homeSignIn} onClick={onLoginClick}>
                  Sign in
                </Link>
                <Link to="/signup" className={styles.homeLoginPill}>
                  Student / Job Seeker Login
                </Link>
              </>
            )
          ) : isLanding ? (
            <>
              <Link to="/login" className={styles.landingSignIn}>
                Sign in
              </Link>
              <Link to="/signup" className={styles.landingLime}>
                Get started
              </Link>
            </>
          ) : (
            <>
              <Link to="/login" className={styles.textBtn}>
                Sign in
              </Link>
              <Link to="/signup" className={styles.loginPill}>
                Get started
              </Link>
            </>
          )}

          <button
            type="button"
            className={styles.menuBtn}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              {open ? (
                <path
                  d="M6 6L18 18M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d="M4 7H20M4 12H20M4 17H20"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
        </div>

        <AnimatePresence>
          {open && (
            <motion.nav
              className={styles.mobileMenu}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              aria-label="Mobile"
            >
              {primaryNav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    isActive ? `${styles.mobileLink} ${styles.mobileActive}` : styles.mobileLink
                  }
                >
                  {navLabel(item)}
                </NavLink>
              ))}
              {!loggedIn && (
                <>
                  <NavLink to="/login" onClick={() => setOpen(false)} className={styles.mobileLink}>
                    Sign in
                  </NavLink>
                </>
              )}
              <div className={styles.mobileActions}>
                {loggedIn && !hideSignOut ? (
                  <button type="button" className={styles.signOutBtn} onClick={handleLogout}>
                    Sign out
                  </button>
                ) : loggedIn ? null : (
                  <>
                    <Link to="/login" className={styles.loginBtn} onClick={() => setOpen(false)}>
                      Sign in
                    </Link>
                    <Link to="/signup" className={styles.ctaBtn} onClick={() => setOpen(false)}>
                      Create account
                    </Link>
                  </>
                )}
              </div>
            </motion.nav>
          )}
        </AnimatePresence>
      </div>
    </header>
  )
}
