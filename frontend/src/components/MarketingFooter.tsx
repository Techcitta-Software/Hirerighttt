import { Link } from 'react-router-dom'
import { BrandLogo } from './BrandLogo'
import styles from './MarketingFooter.module.css'

const FOOTER_LINKS = [
  { to: '/', label: 'Home' },
  { to: '/how-it-works', label: 'How It Works' },
  { to: '/career-view', label: '360° Career View' },
  { to: '/who-its-for', label: 'Who It’s For' },
  { to: '/faqs', label: 'FAQs' },
  { to: '/contact', label: 'Contact' },
  { to: '/privacy', label: 'Privacy Policy' },
  { to: '/terms', label: 'Terms & Conditions' },
  { to: '/cookies', label: 'Cookie Policy' },
] as const

/** Shared compact footer for public marketing pages (matches MarketingNavBar typography). */
export function MarketingFooter() {
  const year = new Date().getFullYear()

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.mainRow}>
          <div className={styles.brandBlock}>
            <BrandLogo to="/" size="md" dark className={styles.brandLink} />
            <p className={styles.tagline}>Your Personal AI Career Companion</p>
          </div>

          <nav className={styles.nav} aria-label="Footer">
            {FOOTER_LINKS.map((item) => (
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
