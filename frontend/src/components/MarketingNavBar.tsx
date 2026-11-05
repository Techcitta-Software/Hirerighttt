import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { handleLoginNavigation } from '../lib/authSession'
import { BrandLogo } from './BrandLogo'
import styles from './MarketingNavBar.module.css'

type NavChild = { to: string; label: string; desc: string }
type NavItem = {
  to: string
  label: string
  match: readonly string[]
  children?: readonly NavChild[]
}

const ORGANIZATION_MENU: readonly NavChild[] = [
  { to: '/solutions', label: 'Platform overview', desc: 'AI interviews, scorecards and pipeline' },
  { to: '/pricing', label: 'Pricing for teams', desc: 'Plans for recruiters and agencies' },
  { to: '/contact', label: 'Talk to sales', desc: 'Enterprise, ATS and API needs' },
  {
    to: '/organizations/signup',
    label: 'Organization sign up',
    desc: 'Create your vendor / employer account',
  },
]

const MARKETING_NAV: readonly NavItem[] = [
  { to: '/why', label: 'Why us?', match: ['/why'] },
  { to: '/pricing', label: 'Pricing', match: ['/pricing'] },
  {
    to: '/career-view',
    label: '360° Report',
    match: ['/career-view', '/360-career-view', '/career'],
  },
  {
    to: '/solutions',
    label: 'For organizations',
    match: ['/solutions', '/organizations/signup'],
    children: ORGANIZATION_MENU,
  },
  { to: '/contact', label: 'Contact us', match: ['/contact'] },
]

function isActive(pathname: string, match: readonly string[]) {
  return match.some((p) => pathname === p)
}

function navLinkClass(pathname: string, match: readonly string[]) {
  return `${styles.navLink} ${isActive(pathname, match) ? styles.navLinkActive : ''}`
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

/**
 * Public marketing header for pre-login pages only (not used on candidate dashboard / app shell).
 */
export function MarketingNavBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [orgMenuOpen, setOrgMenuOpen] = useState(false)
  const [mobileOrgOpen, setMobileOrgOpen] = useState(false)
  const orgRef = useRef<HTMLLIElement>(null)

  function closeAll() {
    setMobileMenuOpen(false)
    setOrgMenuOpen(false)
  }

  function onLoginClick(event: MouseEvent) {
    event.preventDefault()
    closeAll()
    void handleLoginNavigation(navigate)
  }

  useEffect(() => {
    closeAll()
  }, [location.pathname])

  useEffect(() => {
    if (!orgMenuOpen) return
    function onPointerDown(e: globalThis.MouseEvent) {
      if (!orgRef.current?.contains(e.target as Node)) setOrgMenuOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOrgMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [orgMenuOpen])

  return (
    <header className={styles.navbar}>
      <div className={styles.navInner}>
        <BrandLogo to="/" size="md" className={styles.brandWrap} onClick={closeAll} />

        <nav aria-label="Main Navigation" className={styles.navCenter}>
          <ul className={styles.navLinks}>
            {MARKETING_NAV.map((item) =>
              item.children ? (
                <li
                  key={item.label}
                  ref={orgRef}
                  className={styles.hasMenu}
                  onMouseEnter={() => setOrgMenuOpen(true)}
                  onMouseLeave={() => setOrgMenuOpen(false)}
                >
                  <button
                    type="button"
                    className={`${navLinkClass(location.pathname, item.match)} ${styles.menuTrigger}`}
                    aria-haspopup="menu"
                    aria-expanded={orgMenuOpen}
                    onClick={() => setOrgMenuOpen((v) => !v)}
                  >
                    {item.label}
                    <Chevron open={orgMenuOpen} />
                  </button>
                  {orgMenuOpen && (
                    <div className={styles.dropdown} role="menu">
                      {item.children.map((child) => (
                        <Link
                          key={child.to}
                          to={child.to}
                          role="menuitem"
                          className={styles.dropdownItem}
                          onClick={() => setOrgMenuOpen(false)}
                        >
                          <span className={styles.dropdownLabel}>{child.label}</span>
                          <span className={styles.dropdownDesc}>{child.desc}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </li>
              ) : (
                <li key={item.to}>
                  <Link to={item.to} className={navLinkClass(location.pathname, item.match)}>
                    {item.label}
                  </Link>
                </li>
              ),
            )}
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
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {mobileMenuOpen ? <path d="M18 6L6 18M6 6l12 12" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
          </svg>
        </button>
      </div>

      <div className={`${styles.mobileMenuDrawer} ${mobileMenuOpen ? styles.mobileOpen : ''}`}>
        {MARKETING_NAV.map((item) =>
          item.children ? (
            <div key={item.label} className={styles.mobileGroup}>
              <button
                type="button"
                className={`${navLinkClass(location.pathname, item.match)} ${styles.menuTrigger}`}
                aria-expanded={mobileOrgOpen}
                onClick={() => setMobileOrgOpen((v) => !v)}
              >
                {item.label}
                <Chevron open={mobileOrgOpen} />
              </button>
              {mobileOrgOpen && (
                <div className={styles.mobileSub}>
                  {item.children.map((child) => (
                    <Link key={child.to} to={child.to} className={styles.mobileSubLink} onClick={closeAll}>
                      {child.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <Link
              key={item.to}
              to={item.to}
              className={navLinkClass(location.pathname, item.match)}
              onClick={closeAll}
            >
              {item.label}
            </Link>
          ),
        )}
        <div className={styles.mobileAuthActions}>
          <Link to="/login" className={styles.navActionLink} onClick={onLoginClick}>
            Log in
          </Link>
          <Link to="/signup" className={styles.navCtaBtn} onClick={closeAll}>
            Sign up
          </Link>
        </div>
      </div>
    </header>
  )
}
