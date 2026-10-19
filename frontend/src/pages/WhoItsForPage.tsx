import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import styles from './WhoItsForPage.module.css'

const AUDIENCES = [
  {
    title: 'Students',
    desc: 'Explore careers, understand your interests and learn what future roles may require.',
  },
  {
    title: 'Fresh Graduates',
    desc: 'Build clarity and prepare confidently for your first job.',
  },
  {
    title: 'Job Seekers',
    desc: 'Find out what to improve and prepare with purpose for your next interview or opportunity.',
  },
  {
    title: 'Working Professionals',
    desc: 'Assess your career direction and prepare for advancement.',
  },
  {
    title: 'Career Switchers',
    desc: 'Explore transferable strengths and the skills needed for a new direction.',
  },
]

export function WhoItsForPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <div className={styles.page}>
      {/* ====================================================================
          Navigation Bar
          ==================================================================== */}
      <header className={styles.navbar}>
        <div className={styles.navInner}>
          <Link to="/" className={styles.brandWrap} aria-label="HireRighttt Home">
            <img
              src="/logos/hirerighttt-logo.svg"
              alt="HireRighttt — Talent to Talent"
              className={styles.brandLogoImg}
            />
          </Link>

          <nav aria-label="Main Navigation">
            <ul className={styles.navLinks}>
              <li>
                <Link to="/" className={styles.navLink}>
                  HOME
                </Link>
              </li>
              <li>
                <Link to="/how-it-works" className={styles.navLink}>
                  HOW IT WORKS
                </Link>
              </li>
              <li>
                <Link to="/career-view" className={styles.navLink}>
                  360° CAREER VIEW
                </Link>
              </li>
              <li>
                <Link to="/who-its-for" className={`${styles.navLink} ${styles.navLinkActive}`}>
                  WHO IT’S FOR
                </Link>
              </li>
              <li>
                <Link to="/faqs" className={styles.navLink}>
                  FAQS
                </Link>
              </li>
            </ul>
          </nav>

          <div className={styles.navActions}>
            <Link to="/login" className={styles.navActionLink}>
              LOG IN
            </Link>
            <Link to="/signup" className={styles.navCtaBtn}>
              SIGN UP
            </Link>
          </div>

          <button
            type="button"
            className={styles.mobileMenuBtn}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
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

        {/* Mobile menu dropdown */}
        <div className={`${styles.mobileMenuDrawer} ${mobileMenuOpen ? styles.mobileOpen : ''}`}>
          <Link to="/" className={styles.navLink} onClick={() => setMobileMenuOpen(false)}>
            HOME
          </Link>
          <Link to="/how-it-works" className={styles.navLink} onClick={() => setMobileMenuOpen(false)}>
            HOW IT WORKS
          </Link>
          <Link to="/career-view" className={styles.navLink} onClick={() => setMobileMenuOpen(false)}>
            360° CAREER VIEW
          </Link>
          <Link
            to="/who-its-for"
            className={`${styles.navLink} ${styles.navLinkActive}`}
            onClick={() => setMobileMenuOpen(false)}
          >
            WHO IT’S FOR
          </Link>
          <Link to="/faqs" className={styles.navLink} onClick={() => setMobileMenuOpen(false)}>
            FAQS
          </Link>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
            <Link to="/login" className={styles.navActionLink} onClick={() => setMobileMenuOpen(false)}>
              LOG IN
            </Link>
            <Link to="/signup" className={styles.navCtaBtn} onClick={() => setMobileMenuOpen(false)}>
              SIGN UP
            </Link>
          </div>
        </div>
      </header>

      {/* ====================================================================
          Page Header
          ==================================================================== */}
      <section className={styles.pageHeader}>
        <div className={styles.shell}>
          <motion.p
            className={styles.overline}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            WHO IT’S FOR
          </motion.p>

          <motion.h1
            className={styles.heading}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            Whatever Your Career Stage,{' '}
            <span className={styles.gradientText}>There’s a Next Step.</span>
          </motion.h1>

          <motion.p
            className={styles.subheading}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            HireRighttt is built for people at every point of their career journey.
          </motion.p>
        </div>
      </section>

      {/* ====================================================================
          Audience Cards Grid
          ==================================================================== */}
      <section className={styles.cardsSection}>
        <div className={styles.shell}>
          <div className={styles.cardsGrid}>
            {AUDIENCES.map((item, index) => (
              <motion.article
                key={item.title}
                className={styles.card}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.1 + index * 0.08 }}
              >
                <h2 className={styles.cardTitle}>{item.title}</h2>
                <p className={styles.cardDescription}>{item.desc}</p>
              </motion.article>
            ))}
          </div>

          <motion.div
            className={styles.ctaArea}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
          >
            <Link to="/signup" className={styles.ctaBtn}>
              START MY CAREER DISCOVERY
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ====================================================================
          Footer
          ==================================================================== */}
      <footer className={styles.footer}>
        <div className={`${styles.shell} ${styles.footerInner}`}>
          <div className={styles.footerTop}>
            <div className={styles.footerBrandColumn}>
              <Link to="/" className={styles.footerBrandWrap}>
                <img
                  src="/logos/hirerighttt-logo-dark.svg"
                  alt="HireRighttt — Talent to Talent"
                  className={styles.footerLogoImg}
                />
              </Link>
              <p className={styles.footerTagline}>Your Personal AI Career Companion</p>
            </div>

            <nav className={styles.footerLinksRow} aria-label="Footer Navigation">
              <Link to="/" className={styles.footerLink}>
                Home
              </Link>
              <Link to="/how-it-works" className={styles.footerLink}>
                How It Works
              </Link>
              <Link to="/faqs" className={styles.footerLink}>
                FAQs
              </Link>
              <Link to="/contact" className={styles.footerLink}>
                Contact
              </Link>
              <Link to="/privacy" className={styles.footerLink}>
                Privacy Policy
              </Link>
              <Link to="/terms" className={styles.footerLink}>
                Terms &amp; Conditions
              </Link>
              <Link to="/cookies" className={styles.footerLink}>
                Cookie Policy
              </Link>
            </nav>
          </div>

          <div className={styles.footerDivider} />

          <div className={styles.footerBottom}>
            <p className={styles.footerCopyright}>
              © 2026 HireRighttt. All rights reserved. [Replace with legal entity / company details
              before launch]
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
