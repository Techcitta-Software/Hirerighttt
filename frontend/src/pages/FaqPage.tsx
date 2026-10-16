import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import styles from './FaqPage.module.css'

interface FaqItem {
  question: string
  answer: string
}

const FAQS: FaqItem[] = [
  {
    question: 'Do I need a resume to begin?',
    answer: 'No. Start with a short conversation. You may choose to add more information later.',
  },
  {
    question: 'Who is HireRighttt for?',
    answer:
      'HireRighttt is built for anyone navigating their career — students, fresh graduates, job seekers, working professionals looking to advance, and career switchers.',
  },
  {
    question: 'What happens in the 15-minute conversation?',
    answer:
      'You will have an interactive conversation with Ava, our AI career companion, exploring your background, strengths, interests, and aspirations to build a comprehensive picture of your potential.',
  },
  {
    question: 'What do I receive afterward?',
    answer:
      'You receive a detailed 360° Career Intelligence Report featuring clear competency scores, personalized recommendations, identified strengths, and actionable next steps.',
  },
  {
    question: 'Can it help me get a job?',
    answer:
      'Yes. Beyond career clarity, your verified 360° report and score can be shared directly with hiring employers and matched opportunities on our platform.',
  },
  {
    question: 'Is the 15-minute assessment final?',
    answer:
      'No. You can retake the discovery conversation or practice specific modules as you build new skills, gain experience, or refine your goals.',
  },
]

export function FaqPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  // Default first item (index 0) open, matching the screenshot
  const [openIndices, setOpenIndices] = useState<number[]>([0])

  function toggleIndex(index: number) {
    if (openIndices.includes(index)) {
      setOpenIndices(openIndices.filter((i) => i !== index))
    } else {
      setOpenIndices([...openIndices, index])
    }
  }

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
                <Link to="/who-its-for" className={styles.navLink}>
                  WHO IT’S FOR
                </Link>
              </li>
              <li>
                <Link to="/faqs" className={`${styles.navLink} ${styles.navLinkActive}`}>
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
          <Link to="/who-its-for" className={styles.navLink} onClick={() => setMobileMenuOpen(false)}>
            WHO IT’S FOR
          </Link>
          <Link
            to="/faqs"
            className={`${styles.navLink} ${styles.navLinkActive}`}
            onClick={() => setMobileMenuOpen(false)}
          >
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
            FAQS
          </motion.p>

          <motion.h1
            className={styles.heading}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            Frequently Asked{' '}
            <span className={styles.gradientText}>Questions</span>
          </motion.h1>
        </div>
      </section>

      {/* ====================================================================
          Accordion Section
          ==================================================================== */}
      <section className={styles.accordionSection}>
        <div className={styles.shell}>
          <div className={styles.accordionList}>
            {FAQS.map((faq, index) => {
              const isOpen = openIndices.includes(index)
              return (
                <motion.div
                  key={faq.question}
                  className={`${styles.accordionItem} ${isOpen ? styles.accordionItemOpen : ''}`}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.05 * index }}
                >
                  <button
                    type="button"
                    className={styles.accordionHeader}
                    onClick={() => toggleIndex(index)}
                    aria-expanded={isOpen}
                  >
                    <h2 className={styles.questionText}>{faq.question}</h2>
                    <span className={styles.iconWrap} aria-hidden>
                      {isOpen ? '−' : '+'}
                    </span>
                  </button>

                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        className={styles.accordionBody}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25, ease: 'easeInOut' }}
                      >
                        <p className={styles.answerText}>{faq.answer}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })}
          </div>

          <motion.div
            className={styles.bottomCtaArea}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.35 }}
          >
            <p className={styles.ctaPrompt}>Ready to find your next step?</p>
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
              <Link to="/about" className={styles.footerLink}>
                Privacy Policy
              </Link>
              <Link to="/about" className={styles.footerLink}>
                Terms of Use
              </Link>
              <Link to="/about" className={styles.footerLink}>
                Cookie Preferences
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
