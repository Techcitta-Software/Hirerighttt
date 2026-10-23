import { useState, type MouseEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { handleLoginNavigation } from '../lib/authSession'
import { BrandLogo } from './BrandLogo'
import styles from './MarketingNavBar.module.css'

const MARKETING_NAV = [
  { to: '/', label: 'Home', match: ['/'] },
  { to: '/how-it-works', label: 'How It Works', match: ['/how-it-works'] },
  {
    to: '/career-view',
    label: '360° Career View',
    match: ['/career-view', '/360-career-view', '/career'],
  },
  { to: '/who-its-for', label: 'Who It’s For', match: ['/who-its-for', '/job-seekers'] },
  { to: '/faqs', label: 'FAQs', match: ['/faqs', '/faq', '/about'] },
] as const

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
  const navigate = useNavigate()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  function closeMobile() {
    setMobileMenuOpen(false)
  }

  function onLoginClick(event: MouseEvent) {
    event.preventDefault()
    closeMobile()
    void handleLoginNavigation(navigate)
  }

  return (
    <header className={styles.navbar}>
      <div className={styles.navInner}>
        <BrandLogo
          to="/"
          size="md"
          className={styles.brandWrap}
          onClick={closeMobile}
        />

        <nav aria-label="Main Navigation">
          <ul className={styles.navLinks}>
            {MARKETING_NAV.map((item) => (
              <li key={item.to}>
                <Link to={item.to} className={navLinkClass(location.pathname, item.match)}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className={styles.navActions}>
          <Link to="/login" className={styles.navActionLink} onClick={onLoginClick}>
            Log in
          </Link>
          <Link to="/signup" className={styles.navCtaBtn}>
            Sign up
          </Link>
        </div>

        <button
          type="button"
          className={styles.mobileMenuBtn}
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-expanded={mobileMenuOpen}
          aria-label="Toggle Menu"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {mobileMenuOpen ? (
              <path d="M18 6L6 18M6 6l12 12" />
            ) : (
              <path d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      <div className={`${styles.mobileMenuDrawer} ${mobileMenuOpen ? styles.mobileOpen : ''}`}>
        {MARKETING_NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={navLinkClass(location.pathname, item.match)}
            onClick={closeMobile}
          >
            {item.label}
          </Link>
        ))}
        <div className={styles.mobileAuthActions}>
          <Link to="/login" className={styles.navActionLink} onClick={onLoginClick}>
            Log in
          </Link>
          <Link to="/signup" className={styles.navCtaBtn} onClick={closeMobile}>
            Sign up
          </Link>
        </div>
      </div>
    </header>
  )
}
