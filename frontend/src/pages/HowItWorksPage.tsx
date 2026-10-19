import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import styles from './HowItWorksPage.module.css'

const STEPS_TOP = [
  {
    num: '01',
    title: 'Talk for 15 Minutes',
    desc: 'Have a natural AI-guided conversation about your interests, experiences, skills, aspirations and challenges.',
  },
  {
    num: '02',
    title: 'Discover Your 360° View',
    desc: 'Receive initial insights into strengths, potential gaps, communication, career direction and job readiness.',
  },
  {
    num: '03',
    title: 'Know Your Next Steps',
    desc: 'Get prioritized recommendations for career exploration, skill improvement and interview preparation.',
  },
]

const HELP_CARDS = [
  {
    title: 'AI Interview Practice',
    desc: 'Prepare for technical, behavioral and HR interviews with guided, role-specific practice.',
  },
  {
    title: 'Personalized Skill Development',
    desc: 'Know what to learn next and why it matters for your target role.',
  },
  {
    title: 'Career & Job Readiness',
    desc: 'Understand the capabilities employers may expect and prepare for relevant opportunities.',
  },
  {
    title: 'Progress & Growth',
    desc: 'Track completed actions and improve your career readiness over time.',
  },
]

export function HowItWorksPage() {
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
                <Link to="/how-it-works" className={`${styles.navLink} ${styles.navLinkActive}`}>
                  HOW IT WORKS
                </Link>
              </li>
              <li>
                <Link to="/career-view" className={styles.navLink}>
                  360° CAREER VIEW
                </Link>
              </li>
              <li>
                <Link to="/who-its-for" className={styles.navLink}>
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
          <Link
            to="/how-it-works"
            className={`${styles.navLink} ${styles.navLinkActive}`}
            onClick={() => setMobileMenuOpen(false)}
          >
            HOW IT WORKS
          </Link>
          <Link to="/career-view" className={styles.navLink} onClick={() => setMobileMenuOpen(false)}>
            360° CAREER VIEW
          </Link>
          <Link to="/who-its-for" className={styles.navLink} onClick={() => setMobileMenuOpen(false)}>
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
            HOW IT WORKS
          </motion.p>

          <motion.h1
            className={styles.heading}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            Career Clarity Starts with a{' '}
            <span className={styles.gradientText}>Conversation.</span>
          </motion.h1>

          <motion.p
            className={styles.subheading}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            No forms to fill and no resume needed. Just four simple steps from talking to
            taking action.
          </motion.p>
        </div>
      </section>

      {/* ====================================================================
          Steps Section
          ==================================================================== */}
      <section className={styles.stepsSection}>
        <div className={styles.shell}>
          {/* Top 3 Steps */}
          <div className={styles.stepsGridTop}>
            {STEPS_TOP.map((step, index) => (
              <motion.article
                key={step.num}
                className={styles.stepCard}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.08 * index }}
              >
                <div className={styles.stepBadge}>{step.num}</div>
                <h2 className={styles.stepTitle}>{step.title}</h2>
                <p className={styles.stepDesc}>{step.desc}</p>
              </motion.article>
            ))}
          </div>

          {/* Step 04 */}
          <motion.article
            className={styles.stepCardFull}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.28 }}
          >
            <div className={styles.stepBadge}>04</div>
            <h2 className={styles.stepTitle}>Keep Moving Forward</h2>
            <p className={styles.stepDesc}>
              Practice interviews, follow a development plan and update your insights as you
              improve.
            </p>
          </motion.article>

          {/* CTA */}
          <div className={styles.stepCtaArea}>
            <Link to="/signup" className={styles.primaryDiscoveryBtn}>
              START MY 15-MINUTE DISCOVERY
            </Link>
          </div>
        </div>
      </section>

      {/* ====================================================================
          "We Don’t Just Show You..." Section
          ==================================================================== */}
      <section className={styles.helpSection}>
        <div className={styles.shell}>
          <motion.h2
            className={styles.helpHeading}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            We Don’t Just Show You What to Improve.{' '}
            <span className={styles.gradientText}>We Help You Get There.</span>
          </motion.h2>

          <div className={styles.helpGrid}>
            {HELP_CARDS.map((card, index) => (
              <motion.article
                key={card.title}
                className={styles.helpCard}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.45, delay: 0.08 * index }}
              >
                <h3 className={styles.helpCardTitle}>{card.title}</h3>
                <p className={styles.helpCardDesc}>{card.desc}</p>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      {/* ====================================================================
          CTA Banner Card (Page 2)
          ==================================================================== */}
      <section className={styles.ctaSection}>
        <div className={styles.shell}>
          <motion.div
            className={styles.ctaCard}
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <h2 className={styles.ctaHeading}>
              Your Next Opportunity Starts with One Conversation.
            </h2>
            <Link to="/signup" className={styles.ctaBtn}>
              START MY CAREER DISCOVERY
            </Link>
            <p className={styles.ctaFootnote}>
              No resume required to get started • Personalized AI-powered guidance
            </p>
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
