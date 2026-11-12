import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
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
    to: '/organizations/signup',
    label: 'Organisations',
    match: ['/solutions', '/organizations/signup'],
  },
  { to: '/contact', label: 'Contact us', match: ['/contact'] },
]

function isActive(pathname: string, match: readonly string[]) {
  return match.some((p) => pathname === p)
}

function navLinkClass(pathname: string, match: readonly string[]) {
  return `${styles.navLink} ${isActive(pathname, match) ? styles.navLinkActive : ''}`
}

/**
 * Public marketing header for pre-login pages only (not used on candidate dashboard / app shell).
 */
export function MarketingNavBar() {
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  function closeAll() {
    setMobileMenuOpen(false)
  }

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  const orgState = (to: string) => (to === '/organizations/signup' ? { explicitSignup: true } : undefined)

  return (
    <header className={styles.navbar}>
      <div className={styles.navInner}>
        <BrandLogo to="/" size="md" className={styles.brandWrap} onClick={closeAll} />

        <nav aria-label="Main Navigation" className={styles.navCenter}>
          <ul className={styles.navLinks}>
            {MARKETING_NAV.map((item) => (
              <li key={item.to}>
                <Link to={item.to} state={orgState(item.to)} className={navLinkClass(location.pathname, item.match)}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className={styles.navActions}>
          <Link to="/signup" state={{ explicitSignup: true }} className={styles.navCtaBtn}>
            Get started
          </Link>
        </div>

        <button
          type="button"
          className={styles.mobileMenuBtn}
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-expanded={mobileMenuOpen}
          aria-label="Toggle Menu"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {mobileMenuOpen ? <path d="M18 6L6 18M6 6l12 12" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
          </svg>
        </button>
      </div>

      <div className={`${styles.mobileMenuDrawer} ${mobileMenuOpen ? styles.mobileOpen : ''}`}>
        {MARKETING_NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            state={orgState(item.to)}
            className={navLinkClass(location.pathname, item.match)}
            onClick={closeAll}
          >
            {item.label}
          </Link>
        ))}
        <div className={styles.mobileAuthActions}>
          <Link to="/signup" state={{ explicitSignup: true }} className={styles.navCtaBtn} onClick={closeAll}>
            Get started
          </Link>
        </div>
      </div>
    </header>
  )
}
