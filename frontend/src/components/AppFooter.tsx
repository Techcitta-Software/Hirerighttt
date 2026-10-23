import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getUser, isLoggedIn } from '../lib/store'
import styles from './AppFooter.module.css'

const CANDIDATE_LINKS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/jobs', label: 'Matches' },
  { to: '/applications', label: 'Applications' },
  { to: '/profile', label: 'Profile' },
  { to: '/settings', label: 'Settings' },
  { to: '/privacy', label: 'Privacy' },
  { to: '/terms', label: 'Terms' },
] as const

const EMPLOYER_LINKS = [
  { to: '/employer/dashboard', label: 'Jobs' },
  { to: '/employer/candidates', label: 'Candidates' },
  { to: '/resumes', label: 'Talent vault' },
  { to: '/privacy', label: 'Privacy' },
  { to: '/terms', label: 'Terms' },
] as const

/** Compact footer for authenticated app pages (matches AppNavBar / MarketingFooter typography). */
export function AppFooter() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn())
  const user = getUser()

  useEffect(() => {
    function sync() {
      setLoggedIn(isLoggedIn())
    }
    sync()
    window.addEventListener('hireright-auth', sync)
    return () => window.removeEventListener('hireright-auth', sync)
  }, [])

  if (!loggedIn) return null

  const links = user?.role === 'employer' ? EMPLOYER_LINKS : CANDIDATE_LINKS
  const year = new Date().getFullYear()

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.mainRow}>
          <div className={styles.brandBlock}>
            <Link to={user?.role === 'employer' ? '/employer/dashboard' : '/dashboard'} className={styles.brandLink}>
              <img src="/logos/hirerighttt-logo-dark.svg" alt="" className={styles.logo} />
            </Link>
            <p className={styles.tagline}>Fair AI interviews and clear scorecards.</p>
          </div>
          <nav className={styles.nav} aria-label="App footer">
            {links.map((item) => (
              <Link key={item.to} to={item.to} className={styles.link}>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className={styles.bottomRow}>
          <p className={styles.copyright}>© {year} HireRighttt. All rights reserved.</p>
        </div>
      </div>
    </footer>
  )
}
