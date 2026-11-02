import { useState, useRef, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  clearStoredAuth,
  isApiSessionValid,
  resolveAuthenticatedDestination,
  setAuthInvalidMessage,
} from '../lib/authSession'
import { requireApiForAuth } from '../lib/authConfig'
import { getUser } from '../lib/store'
import { setPendingResume } from '../lib/pendingResume'
import { MarketingNavBar } from '../components/MarketingNavBar'
import { MarketingFooter } from '../components/MarketingFooter'
import styles from './HomePage.module.css'

export function HomePage() {
  const navigate = useNavigate()
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

    let user = getUser()
    if (requireApiForAuth()) {
      if (!user || !(await isApiSessionValid())) {
        if (user) {
          clearStoredAuth()
          setAuthInvalidMessage('Sign in to upload your resume and continue your profile.')
        }
        navigate(user ? '/login' : '/signup', {
          replace: false,
          state: { from: '/onboarding', reason: 'upload_resume' },
        })
        if (e.target) e.target.value = ''
        return
      }
      user = getUser()
    }

    if (user) {
      if (user.role === 'employer') {
        navigate('/employer/dashboard')
      } else {
        navigate(resolveAuthenticatedDestination(user))
      }
    } else {
      navigate('/signup', { state: { reason: 'upload_resume' } })
    }

    // Reset input so re-selecting the same file triggers change
    if (e.target) {
      e.target.value = ''
    }
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

      <MarketingNavBar />

      {/* ====================================================================
          Section 2: Hero Section (Centered 100% Viewport Design)
          ==================================================================== */}
      <section className={styles.heroSection}>
        {/* Background Concentric Radar Rings & Radiant Ambient Glows */}
        <div className={styles.heroBgOrbits} aria-hidden="true">
          <div className={styles.orbitCircle1} />
          <div className={styles.orbitCircle2} />
          <div className={styles.orbitCircle3} />
          <div className={styles.orbitCircle4} />
          <div className={styles.orbitCircle5} />
          <div className={styles.heroGlowWarm} />
          <div className={styles.heroGlowCenter} />
          <div className={styles.heroGlowLavender} />
          <div className={styles.bokehOrb1} />
          <div className={styles.bokehOrb2} />
          <div className={styles.bokehOrb3} />
          <div className={styles.bokehOrb4} />
          <div className={styles.bokehOrb5} />
          <div className={styles.bokehOrb6} />
          <div className={styles.sparkle1}>✦</div>
          <div className={styles.sparkle2}>✦</div>
        </div>

        <div className={styles.heroCenteredShell}>
          <motion.div
            className={styles.heroContentWrap}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            {/* Top Kicker Pill Badge */}
            <div className={styles.heroKickerBadge}>
              <span className={styles.kickerSparkle}>✦</span>
              <span>YOUR PERSONAL AI CAREER COMPANION</span>
            </div>

            {/* Main Headline */}
            <h1 className={styles.heroHeadingCentered}>
              Your Future Starts with{' '}
              <span className={styles.heroHeadingBlue}>Understanding You.</span>
            </h1>

            {/* Subtitle */}
            <p className={styles.heroSubheadingCentered}>
              One 15-Minute Conversation. <strong>Your 360° Career View.</strong>
            </p>

            {/* Vertically Stacked Action Capsules */}
            <div className={styles.heroCapsulesStack}>
              {/* Capsule 1: Job Seeker Resume Upload */}
              <div className={styles.heroActionCapsule}>
                <div
                  className={styles.capsuleLeftTrigger}
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
                  <span className={styles.capsuleTriggerText}>
                    Upload your resume <span className={styles.capsuleFormats}>(PDF, DOC, DOCX)</span>
                  </span>
                </div>

                <button
                  type="button"
                  className={styles.capsuleActionBtn}
                  onClick={handleResumeUploadClick}
                >
                  <span>Upload Resume</span>
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </button>
              </div>

              {/* Capsule 2: Recruiter */}
              <div className={styles.heroActionCapsule}>
                <div
                  className={styles.capsuleLeftTrigger}
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
                  <div className={styles.capsuleIconWrap}>
                    <svg
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
                      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                  </div>
                  <span className={styles.capsuleTriggerText}>
                    Hiring? Meet talent that's ready.
                  </span>
                </div>

                <button
                  type="button"
                  className={styles.capsuleActionBtn}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRecruiterClick()
                  }}
                >
                  <span>For Recruiters</span>
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Meta Row: 3 Feature highlights */}
            <div className={styles.heroMetaRow}>
              <div className={styles.metaItem}>
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={styles.metaIcon}
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span>Approximately 15 minutes</span>
              </div>

              <div className={styles.metaItem}>
                <span className={styles.metaSparkleIcon}>✦</span>
                <span>Personalized insights</span>
              </div>

              <div className={styles.metaItem}>
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={styles.metaIcon}
                >
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="6" />
                  <circle cx="12" cy="12" r="2" fill="currentColor" />
                </svg>
                <span>Clear next steps</span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ====================================================================
          Section 3: Great Potential Deserves Clear Direction (after upload)
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
          Section 5: How It Works (Process Steps Pipeline matching Image 1)
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
                Upload your resume, highlight your skills and set your target career roles.
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
          Section 4: Career discovery intro + CTAs
          ==================================================================== */}
      <section className={styles.careerDiscoverySection}>
        <div className={styles.heroCenteredShell}>
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
        </div>
      </section>

      <MarketingFooter />

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
