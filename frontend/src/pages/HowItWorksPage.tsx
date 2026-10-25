import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { MarketingNavBar } from '../components/MarketingNavBar'
import { MarketingFooter } from '../components/MarketingFooter'
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
  return (
    <div className={styles.page}>
      <MarketingNavBar />

      {/* ====================================================================
          Page Header
          ==================================================================== */}
      <section className={styles.pageHeader}>
        <div className={styles.pageHeaderContent}>
          <motion.p
            className={styles.overline}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >How It Works</motion.p>

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
          <div className={styles.contentColumn}>
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
        </div>
      </section>

      {/* ====================================================================
          "We Don’t Just Show You..." Section
          ==================================================================== */}
      <section className={styles.helpSection}>
        <div className={styles.shell}>
          <div className={styles.contentColumn}>
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
        </div>
      </section>

      {/* ====================================================================
          CTA Banner Card (Page 2)
          ==================================================================== */}
      <section className={styles.ctaSection}>
        <div className={styles.shell}>
          <div className={styles.contentColumn}>
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
        </div>
      </section>

      <MarketingFooter />
    </div>
  )
}
