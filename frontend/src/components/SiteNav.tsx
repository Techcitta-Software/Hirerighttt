import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
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

const JOBSEEKER_NAV = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/jobs', label: 'Matches' },
  { to: '/applications', label: 'Applications' },
]

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
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const [loggedIn, setLoggedIn] = useState(false)
  const [unread, setUnread] = useState(0)
  const user = getUser()
  const initials = useMemo(() => {
    const raw = (user?.name || user?.companyName || '').trim()
    if (!raw) return user?.role === 'employer' ? 'EM' : 'HR'
    const parts = raw.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase()
    }
    return raw.slice(0, 2).toUpperCase()
  }, [user?.name, user?.companyName, user?.role])
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

  useEffect(() => {
    setProfileMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!profileMenuOpen) return
    function onPointerDown(event: globalThis.MouseEvent) {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setProfileMenuOpen(false)
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setProfileMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [profileMenuOpen])

  function goFromProfileMenu(path: string) {
    setProfileMenuOpen(false)
    setOpen(false)
    navigate(path)
  }

  function handleLogout() {
    setOpen(false)
    setProfileMenuOpen(false)
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

  const isAppShellNav = loggedIn && variant === 'default' && !showMarketingOnHome

  const headerClass = [
    styles.navbar,
    variant === 'minimal' && styles.navbarMinimal,
    isLanding && styles.navbarLanding,
    isHome && styles.navbarHome,
    isAppShellNav && styles.navbarApp,
  ]
    .filter(Boolean)
    .join(' ')

  const innerClass = [
    isLanding ? styles.innerLanding : styles.inner,
    isAppShellNav && styles.innerApp,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <header className={headerClass}>
      <div className={innerClass}>
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


        <div className={isAppShellNav ? styles.navRight : styles.navRightPassthrough}>
          <nav
            className={isLanding ? styles.navPillGroup : styles.navLinks}
            aria-label="Primary"
          >
            {primaryNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => {
                  const isCurrent =
                    isActive ||
                    (item.to === '/employer/dashboard' && location.pathname === '/employer') ||
                    (item.to === '/employer/candidates' && location.pathname === '/candidates')
                  return isLanding
                    ? isCurrent
                      ? `${styles.navPillLink} ${styles.navPillActive}`
                      : styles.navPillLink
                    : isCurrent
                      ? `${styles.navLink} ${styles.active}`
                      : styles.navLink
                }}
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
              {user?.role !== 'employer' && (
                <Link
                  to="/applications"
                  className={styles.bellBtn}
                  aria-label="Notifications"
                  title={unread > 0 ? `${unread} unread notifications` : 'Notifications'}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                  {unread > 0 && <span className={styles.bellBadge}>{unread}</span>}
                </Link>
              )}

              {/* User profile avatar icon & dropdown menu (both candidate and employer) */}
              <div className={styles.profileMenuWrap} ref={profileMenuRef}>
                <button
                  type="button"
                  className={`${styles.avatarCircle} ${styles.avatarBtn}`}
                  title={user?.name || user?.companyName || 'Account menu'}
                  aria-label="Open account menu"
                  aria-expanded={profileMenuOpen}
                  aria-haspopup="menu"
                  onClick={() => {
                    setOpen(false)
                    setProfileMenuOpen((v) => !v)
                  }}
                >
                  {initials}
                </button>
                <AnimatePresence>
                  {profileMenuOpen && (
                    <motion.div
                      className={styles.profileDropdown}
                      role="menu"
                      initial={{ opacity: 0, y: -6, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, scale: 0.97 }}
                      transition={{ duration: 0.15 }}
                    >
                      <div className={styles.profileDropdownHeader}>
                        <p className={styles.profileDropdownName}>
                          {user?.name || user?.companyName || (user?.role === 'employer' ? 'Employer' : 'Candidate')}
                        </p>
                        <p className={styles.profileDropdownEmail}>{user?.email}</p>
                        <span className={styles.profileDropdownBadge}>
                          {user?.role === 'employer'
                            ? (user?.companyName ? user.companyName : 'Employer Portal')
                            : 'Candidate'}
                        </span>
                      </div>
                      <div className={styles.profileDropdownDivider} />
                      {user?.role === 'employer' ? (
                        <>
                          <button
                            type="button"
                            role="menuitem"
                            className={styles.profileDropdownItem}
                            onClick={() => goFromProfileMenu('/employer/dashboard')}
                          >
                            Jobs &amp; Openings
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className={styles.profileDropdownItem}
                            onClick={() => goFromProfileMenu('/employer/candidates')}
                          >
                            Candidate directory
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className={styles.profileDropdownItem}
                            onClick={() => goFromProfileMenu('/settings')}
                          >
                            Account settings
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            role="menuitem"
                            className={styles.profileDropdownItem}
                            onClick={() => goFromProfileMenu('/profile')}
                          >
                            View &amp; edit profile
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className={styles.profileDropdownItem}
                            onClick={() => goFromProfileMenu('/dashboard')}
                          >
                            Dashboard
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className={styles.profileDropdownItem}
                            onClick={() => goFromProfileMenu('/settings')}
                          >
                            Account settings
                          </button>
                        </>
                      )}
                      <div className={styles.profileDropdownDivider} />
                      <button
                        type="button"
                        role="menuitem"
                        className={`${styles.profileDropdownItem} ${styles.profileDropdownDanger}`}
                        onClick={handleLogout}
                      >
                        Sign out
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
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
              {loggedIn && (
                <>
                  {user?.role === 'employer' ? (
                    <>
                      <NavLink
                        to="/employer/dashboard"
                        onClick={() => setOpen(false)}
                        className={({ isActive }) =>
                          isActive ? `${styles.mobileLink} ${styles.mobileActive}` : styles.mobileLink
                        }
                      >
                        Jobs &amp; Openings
                      </NavLink>
                      <NavLink
                        to="/employer/candidates"
                        onClick={() => setOpen(false)}
                        className={({ isActive }) =>
                          isActive ? `${styles.mobileLink} ${styles.mobileActive}` : styles.mobileLink
                        }
                      >
                        Candidates
                      </NavLink>
                      <NavLink
                        to="/settings"
                        onClick={() => setOpen(false)}
                        className={({ isActive }) =>
                          isActive ? `${styles.mobileLink} ${styles.mobileActive}` : styles.mobileLink
                        }
                      >
                        Settings
                      </NavLink>
                    </>
                  ) : (
                    <>
                      <NavLink
                        to="/profile"
                        onClick={() => setOpen(false)}
                        className={({ isActive }) =>
                          isActive ? `${styles.mobileLink} ${styles.mobileActive}` : styles.mobileLink
                        }
                      >
                        Profile
                      </NavLink>
                      <NavLink
                        to="/settings"
                        onClick={() => setOpen(false)}
                        className={({ isActive }) =>
                          isActive ? `${styles.mobileLink} ${styles.mobileActive}` : styles.mobileLink
                        }
                      >
                        Settings
                      </NavLink>
                    </>
                  )}
                </>
              )}
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
