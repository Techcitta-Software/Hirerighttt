import { useState, useRef, type ChangeEvent, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { handleLoginNavigation, resolveAuthenticatedDestination } from '../lib/authSession'
import { getUser } from '../lib/store'
import { setPendingResume } from '../lib/pendingResume'
import styles from './HomePage.module.css'

export function HomePage() {
  const navigate = useNavigate()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [showSampleModal, setShowSampleModal] = useState(false)
  const resumeFileInputRef = useRef<HTMLInputElement>(null)

  function handleResumeUploadClick() {
    resumeFileInputRef.current?.click()
  }

  async function handleResumeFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      await setPendingResume(file)
    } catch (err) {
      console.warn('Failed to save pending resume', err)
    }

    sessionStorage.setItem('hireright.intent', 'upload_resume')
    const user = getUser()
    if (user) {
      if (user.role === 'employer') {
        navigate('/employer/dashboard')
      } else {
        navigate(resolveAuthenticatedDestination(user))
      }
    } else {
      navigate('/signup')
    }

    // Reset input so re-selecting the same file triggers change
    if (e.target) {
      e.target.value = ''
    }
  }

  function handleLoginClick(event: MouseEvent) {
    event.preventDefault()
    setMobileMenuOpen(false)
    void handleLoginNavigation(navigate)
  }

  function handleRecruiterClick() {
    const user = getUser()
    if (user && user.role === 'employer') {
      navigate('/employer/dashboard')
    } else {
      navigate('/signup?role=employer')
    }
  }

  return (
    <div className={styles.page}>
      {/* Hidden file input triggered by "Upload Resume" capsule */}
      <input
        ref={resumeFileInputRef}
        type="file"
        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        style={{ display: 'none' }}
        onChange={handleResumeFileSelected}
        aria-hidden="true"
      />

      {/* ====================================================================
          Section 1: Navigation Bar
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
                <Link to="/faqs" className={styles.navLink}>
                  FAQS
                </Link>
              </li>
            </ul>
          </nav>

          <div className={styles.navActions}>
            <Link to="/login" className={styles.navActionLink} onClick={handleLoginClick}>
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
          <Link
            to="/"
            className={styles.navLink}
            onClick={() => setMobileMenuOpen(false)}
          >
            HOME
          </Link>
          <Link
            to="/how-it-works"
            className={styles.navLink}
            onClick={() => setMobileMenuOpen(false)}
          >
            HOW IT WORKS
          </Link>
          <Link
            to="/career-view"
            className={styles.navLink}
            onClick={() => setMobileMenuOpen(false)}
          >
            360° CAREER VIEW
          </Link>
          <Link
            to="/who-its-for"
            className={styles.navLink}
            onClick={() => setMobileMenuOpen(false)}
          >
            WHO IT’S FOR
          </Link>
          <Link
            to="/faqs"
            className={styles.navLink}
            onClick={() => setMobileMenuOpen(false)}
          >
            FAQS
          </Link>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
            <Link
              to="/login"
              className={styles.navActionLink}
              onClick={(e) => {
                handleLoginClick(e)
              }}
            >
              LOG IN
            </Link>
            <Link to="/signup" className={styles.navCtaBtn} onClick={() => setMobileMenuOpen(false)}>
              SIGN UP
            </Link>
          </div>
        </div>
      </header>

      {/* ====================================================================
          Section 2: Hero Section
          ==================================================================== */}
      {/* ====================================================================
          Section 2: Hero Section (Centered 100% Viewport Design)
          ==================================================================== */}
      <section className={styles.heroSection}>
        <div className={styles.heroCenteredShell}>
          <motion.div
            className={styles.heroContentWrap}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <p className={styles.heroKickerCentered}>
              YOUR PERSONAL AI CAREER COMPANION
            </p>

            <h1 className={styles.heroHeadingCentered}>
              Your Future Starts with<br />
              <span className={styles.heroHeadingBlue}>Understanding You.</span>
            </h1>

            <p className={styles.heroSubheadingCentered}>
              One 15–Minute Conversation. Your <strong>360° Career View.</strong>
            </p>

            {/* Dual Audience Upload Capsule Bar */}
            <div className={styles.heroUploadCapsule}>
              {/* Left Side: Job Seeker Resume Upload */}
              <div className={styles.capsuleJobSeekerSide}>
                <div
                  className={styles.capsuleUploadTrigger}
                  onClick={handleResumeUploadClick}
                  role="button"
                  tabIndex={0}
                  aria-label="Upload your resume"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleResumeUploadClick()
                    }
                  }}
                >
                  <svg
                    className={styles.cloudIcon}
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
                    <path d="M12 12v9" />
                    <path d="m16 16-4-4-4 4" />
                  </svg>
                  <span className={styles.capsuleTriggerText}>
                    Upload your resume (PDF, DOC, DOCX)
                  </span>
                </div>

                <button
                  type="button"
                  className={styles.capsuleUploadBtn}
                  onClick={handleResumeUploadClick}
                >
                  Upload Resume
                </button>
              </div>

              {/* Vertical Divider */}
              <div className={styles.capsuleDivider} />

              {/* Right Side: Recruiter CTA */}
              <div
                className={styles.capsuleRecruiterSide}
                onClick={handleRecruiterClick}
                role="button"
                tabIndex={0}
                aria-label="For recruiters"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleRecruiterClick()
                  }
                }}
              >
                <span className={styles.recruiterText}>
                  Hiring? Meet talent that’s ready.
                </span>
                <button
                  type="button"
                  className={styles.capsuleRecruiterBtn}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRecruiterClick()
                  }}
                >
                  For Recruiters
                </button>
              </div>
            </div>

            {/* Helper text below capsule */}
            <div className={styles.capsuleHelperText}>
              <p>Optional. You can also start without a resume.</p>
              <p>
                By uploading, you agree to our{' '}
                <Link to="/privacy" className={styles.privacyLink}>
                  Privacy Policy.
                </Link>
              </p>
            </div>

            {/* Paragraph & Emphasized Sentence */}
            <div className={styles.heroBodyCopy}>
              <p className={styles.heroParagraph}>
                Whether you’re a student exploring your future, searching for your first job, preparing for
                your next opportunity, or planning a career change, HireRighttt helps you discover your
                strengths, understand where you can improve, and take the right next step.
              </p>
              <p className={styles.heroCallout}>
                No lengthy profiles. No resume required to get started. Just a meaningful conversation about
                you.
              </p>
            </div>

            {/* Dual CTA Buttons */}
            <div className={styles.heroCtaWrap}>
              <div className={styles.heroDualBtnRow}>
                <Link to="/signup" className={styles.startDiscoveryBtn}>
                  Start My Career Discovery
                </Link>
                <button
                  type="button"
                  className={styles.viewSampleBtn}
                  onClick={() => setShowSampleModal(true)}
                >
                  View Sample 360° Report
                </button>
              </div>
              <p className={styles.heroMetaNote}>
                Approximately 15 minutes • Personalized insights • Clear next steps
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ====================================================================
          Section 3: Great Potential Deserves Clear Direction
          ==================================================================== */}
      <section className={styles.potentialSection}>
        <div className={styles.shell}>
          <motion.h2
            className={styles.potentialHeading}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            Great Potential Deserves Clear Direction.
          </motion.h2>

          <motion.p
            className={styles.potentialParagraph}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            Not sure which career is right for you? Applying for jobs but struggling to stand out?
            Preparing for interviews without knowing what to focus on? Every career journey brings
            different questions. HireRighttt starts by listening, then helps you turn uncertainty into
            a practical plan.
          </motion.p>

          <motion.p
            className={styles.potentialHighlight}
            initial={{ opacity: 0, scale: 0.98 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            We don’t start with a form. We start with you.
          </motion.p>
        </div>
      </section>

      {/* ====================================================================
          Section 4: How It Works (Process Steps Pipeline matching Image 1)
          ==================================================================== */}
      <section className={styles.howItWorksSection} id="how-it-works">
        <div className={styles.shell}>
          <motion.div
            className={styles.howItWorksHeader}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <h2 className={styles.howItWorksTitle}>How It Works</h2>
            <div className={styles.howItWorksRedBar} />
          </motion.div>

          <div className={styles.howItWorksStepsWrap}>
            <div className={styles.howItWorksConnectorLine} aria-hidden="true" />

            {/* Step 1 */}
            <motion.div
              className={styles.howItWorksStepNode}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              <div className={styles.stepOuterCircle}>
                <div className={`${styles.stepInnerCircle} ${styles.stepInnerRed}`}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="#ef4444" aria-hidden="true">
                    <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
                  </svg>
                </div>
              </div>
              <h3 className={styles.stepTitleText}>
                <span className={styles.stepNumberRed}>1</span> Create Your Profile
              </h3>
              <p className={styles.stepDescText}>
                Upload your résumé, highlight your skills and set your target career roles.
              </p>
            </motion.div>

            {/* Step 2 */}
            <motion.div
              className={styles.howItWorksStepNode}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <div className={styles.stepOuterCircle}>
                <div className={`${styles.stepInnerCircle} ${styles.stepInnerPurple}`}>
                  <svg
                    width="26"
                    height="26"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#8b5cf6"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                    <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
                    <line x1="12" y1="18" x2="12" y2="22" />
                    <line x1="8" y1="22" x2="16" y2="22" />
                  </svg>
                </div>
              </div>
              <h3 className={styles.stepTitleText}>
                <span className={styles.stepNumberPurple}>2</span> Take AI Interview
              </h3>
              <p className={styles.stepDescText}>
                Have a live spoken conversation with Ava to evaluate your real-world capabilities.
              </p>
            </motion.div>

            {/* Step 3 */}
            <motion.div
              className={styles.howItWorksStepNode}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.3 }}
            >
              <div className={styles.stepOuterCircle}>
                <div className={`${styles.stepInnerCircle} ${styles.stepInnerGreen}`}>
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="3.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              </div>
              <h3 className={styles.stepTitleText}>
                <span className={styles.stepNumberGreen}>3</span> Get Your 360° Report
              </h3>
              <p className={styles.stepDescText}>
                Receive instant category scores, skill gap insights and verified talent calibration.
              </p>
            </motion.div>

            {/* Step 4 */}
            <motion.div
              className={styles.howItWorksStepNode}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.4 }}
            >
              <div className={styles.stepOuterCircle}>
                <div className={`${styles.stepInnerCircle} ${styles.stepInnerOrange}`}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="#f59e0b" aria-hidden="true">
                    <path d="M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6 0h-4V4h4v2z" />
                  </svg>
                </div>
              </div>
              <h3 className={styles.stepTitleText}>
                <span className={styles.stepNumberOrange}>4</span> Unlock Matches &amp; Apply
              </h3>
              <p className={styles.stepDescText}>
                Get matched with hiring employers and apply directly with your verified report.
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          Section 7: Footer
          ==================================================================== */}
      <footer className={styles.footer}>
        <div className={styles.shell}>
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
              © {new Date().getFullYear()} HireRight. All rights reserved.
            </p>
          </div>
        </div>
      </footer>

      {/* ====================================================================
          Sample 360° Career Intelligence Report Modal
          ==================================================================== */}
      <AnimatePresence>
        {showSampleModal && (
          <motion.div
            className={styles.modalBackdrop}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowSampleModal(false)}
          >
            <motion.div
              className={styles.modalContent}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className={styles.modalCloseBtn}
                onClick={() => setShowSampleModal(false)}
                aria-label="Close Sample Report"
              >
                ✕
              </button>

              <span className={styles.sampleBadge}>Sample 360° Career Intelligence Report</span>
              <h2 style={{ fontSize: '1.6rem', fontWeight: 800, color: '#181236', margin: '0 0 0.5rem 0' }}>
                Senior Frontend & Full Stack Architect
              </h2>
              <p style={{ color: '#5c567a', fontSize: '0.95rem', margin: '0 0 1.5rem 0' }}>
                Generated after a 15-minute voice & technical discovery interview with Ava AI.
              </p>

              <div className={styles.sampleReportGrid}>
                <div className={styles.sampleMetricCard}>
                  <div className={styles.metricScore}>94%</div>
                  <div className={styles.metricTitle}>Core Competency Alignment</div>
                  <div className={styles.metricDetail}>Top 5% percentile in React & Modern Architecture</div>
                </div>
                <div className={styles.sampleMetricCard}>
                  <div className={styles.metricScore}>88%</div>
                  <div className={styles.metricTitle}>Leadership & Communication</div>
                  <div className={styles.metricDetail}>Strong stakeholder navigation & technical mentorship</div>
                </div>
                <div className={styles.sampleMetricCard}>
                  <div className={styles.metricScore}>91%</div>
                  <div className={styles.metricTitle}>Problem Solving Velocity</div>
                  <div className={styles.metricDetail}>Structured algorithmic and design decision clarity</div>
                </div>
                <div className={styles.sampleMetricCard}>
                  <div className={styles.metricScore}>96%</div>
                  <div className={styles.metricTitle}>Market Readiness Index</div>
                  <div className={styles.metricDetail}>High match for Tier-1 engineering roles</div>
                </div>
              </div>

              <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
                <Link
                  to="/signup"
                  className={styles.heroPrimaryBtn}
                  onClick={() => setShowSampleModal(false)}
                >
                  START MY CAREER DISCOVERY
                </Link>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
