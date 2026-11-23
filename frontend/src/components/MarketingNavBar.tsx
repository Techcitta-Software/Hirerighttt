import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { prefetchOnIntent, prefetchRouteChunk } from '../routeImports'
import { getUser } from '../lib/store'
import { BrandLogo } from './BrandLogo'
import styles from './MarketingNavBar.module.css'

type NavItem = {
  to: string
  label: string
  match: readonly string[]
}

const MARKETING_NAV: readonly NavItem[] = [
  { to: '/why', label: 'Why us?', match: ['/why'] },
  { to: '/pricing', label: 'Pricing', match: ['/pricing'] },
  {
    to: '/career-view',
    label: '360° Report',
    match: ['/career-view', '/360-career-view', '/career'],
  },
  {
    to: '/organizations',
    label: 'Organisations',
    match: ['/for-recruiters', '/organizations', '/organizations/signup', '/solutions'],
  },
  { to: '/contact', label: 'Contact us', match: ['/contact'] },
]

/** Header destinations are small; fetch them once the browser is idle so a click shows the page at once. */
let idlePrefetchStarted = false
function prefetchHeaderPagesWhenIdle() {
  if (idlePrefetchStarted) return
  idlePrefetchStarted = true
  const run = () => {
    for (const item of MARKETING_NAV) void prefetchRouteChunk(item.to)
    void prefetchRouteChunk('/signup')
  }
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 4000 })
  else window.setTimeout(run, 1500)
}

function navLinkClass(pathname: string, match: readonly string[]) {
  return `${styles.navLink} ${match.includes(pathname) ? styles.navLinkActive : ''}`
}

/**
 * Public marketing header for pre-login pages only (not used on candidate dashboard / app shell).
 */
export function MarketingNavBar() {
  const { pathname } = useLocation()
  const user = getUser()
  const dashboardTo = user?.role === 'employer' ? '/employer/dashboard' : '/dashboard'
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const headerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    prefetchHeaderPagesWhenIdle()
  }, [])

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

  // Open menu: Escape or a tap outside the header closes it.
  useEffect(() => {
    if (!mobileMenuOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMobileMenuOpen(false)
    }
    function onPointer(e: PointerEvent) {
      if (!headerRef.current?.contains(e.target as Node)) setMobileMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [mobileMenuOpen])

  const close = () => setMobileMenuOpen(false)

  return (
    <header className={styles.navbar} ref={headerRef}>
      <div className={styles.navInner}>
        <BrandLogo to="/" size="md" className={styles.brandWrap} onClick={close} />

        <nav aria-label="Main Navigation" className={styles.navCenter}>
          <ul className={styles.navLinks}>
            {MARKETING_NAV.map((item) => (
              <li key={item.to}>
                <Link to={item.to} className={navLinkClass(pathname, item.match)} {...prefetchOnIntent(item.to)}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className={styles.navActions}>
          {user ? (
            <Link to={dashboardTo} className={styles.navCtaBtn} {...prefetchOnIntent(dashboardTo)}>
              Dashboard
            </Link>
          ) : (
            <>
              <Link to="/login" state={{ explicitLogin: true }} className={styles.navSignIn} {...prefetchOnIntent('/login')}>
                Sign in
              </Link>
              <Link to="/signup" state={{ explicitSignup: true }} className={styles.navCtaBtn} {...prefetchOnIntent('/signup')}>
                Get started
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          className={styles.mobileMenuBtn}
          onClick={() => setMobileMenuOpen((open) => !open)}
          aria-expanded={mobileMenuOpen}
          aria-controls="marketing-mobile-menu"
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            {mobileMenuOpen ? <path d="M18 6L6 18M6 6l12 12" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
          </svg>
        </button>
      </div>

      {mobileMenuOpen ? (
        <nav id="marketing-mobile-menu" aria-label="Mobile Navigation" className={styles.mobileMenuDrawer}>
          {MARKETING_NAV.map((item) => (
            <Link key={item.to} to={item.to} className={navLinkClass(pathname, item.match)} onClick={close} {...prefetchOnIntent(item.to)}>
              {item.label}
            </Link>
          ))}
          <div className={styles.mobileAuthActions}>
            {user ? (
              <Link to={dashboardTo} className={styles.navCtaBtn} onClick={close}>
                Dashboard
              </Link>
            ) : (
              <>
                <Link to="/login" state={{ explicitLogin: true }} className={styles.navSignIn} onClick={close} {...prefetchOnIntent('/login')}>
                  Sign in
                </Link>
                <Link to="/signup" state={{ explicitSignup: true }} className={styles.navCtaBtn} onClick={close}>
                  Get started
                </Link>
              </>
            )}
          </div>
        </nav>
      ) : null}
    </header>
  )
}
