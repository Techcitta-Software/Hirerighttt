import { motion } from 'framer-motion'
import { MarketingNavBar } from '../components/MarketingNavBar'
import { MarketingFooter } from '../components/MarketingFooter'
import styles from './CareerViewPage.module.css'

const PILLARS = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
    title: 'Strengths & Potential',
    desc: 'Recognize the strengths you demonstrate and the abilities you can build on.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
      </svg>
    ),
    title: 'Career Direction',
    desc: 'Explore job roles and career paths aligned with your interests and aspirations.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
    title: 'Skill Gap Discovery',
    desc: 'Identify potential skills and knowledge gaps relevant to the direction you want to take.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    title: 'Communication Insights',
    desc: 'Understand how you express your ideas, experiences and goals.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </svg>
    ),
    title: 'Job & Interview Readiness',
    desc: 'See where to focus your preparation before pursuing opportunities.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
        <line x1="9" y1="3" x2="9" y2="18" />
        <line x1="15" y1="6" x2="15" y2="21" />
      </svg>
    ),
    title: 'Personalized Action Roadmap',
    desc: 'Get a practical plan with recommended priorities for the next 30, 60 and 90 days.',
  },
]

export function CareerViewPage() {
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
          >360° Career View</motion.p>

          <motion.h1
            className={styles.heading}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            More Than a Score. A Clearer{' '}
            <span className={styles.gradientText}>View of Your Career.</span>
          </motion.h1>

          <motion.p
            className={styles.subheading}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            Your personalized Career Intelligence Report brings together what your first conversation
            reveals — and turns it into practical guidance you can act on.
          </motion.p>
        </div>
      </section>

      {/* ====================================================================
          6 Pillar Cards Grid
          ==================================================================== */}
      <section className={styles.pillarsSection}>
        <div className={styles.shell}>
          <div className={styles.contentColumn}>
          <div className={styles.pillarsGrid}>
            {PILLARS.map((item, index) => (
              <motion.article
                key={item.title}
                className={styles.pillarCard}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.08 * index }}
              >
                <div className={styles.pillarIconBox} aria-hidden>
                  {item.icon}
                </div>
                <h2 className={styles.pillarTitle}>{item.title}</h2>
                <p className={styles.pillarDescription}>{item.desc}</p>
              </motion.article>
            ))}
          </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          Sample Report Preview Section
          ==================================================================== */}
      <section className={styles.reportPreviewSection}>
        <div className={styles.shell}>
          <div className={styles.contentColumn}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <span className={styles.sampleBadge}>
              SAMPLE · EXAMPLE / NOT A REAL ASSESSMENT
            </span>
            <h2 className={styles.previewHeading}>See what your report could look like</h2>
          </motion.div>

          <motion.div
            className={styles.reportCard}
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <div className={styles.reportCardHeader}>
              <h3 className={styles.reportCardTitle}>Your 360° Career View</h3>
              <p className={styles.reportCardIllustrationTag}>Example for illustration only</p>
            </div>

            {/* Row 1 */}
            <div className={styles.reportGridTwoCol}>
              <div className={styles.reportField}>
                <span className={styles.reportFieldLabel}>STRENGTHS &amp; POTENTIAL</span>
                <p className={styles.reportFieldValue}>
                  Clear problem-solving and a habit of helping others learn.
                </p>
              </div>
              <div className={styles.reportField}>
                <span className={styles.reportFieldLabel}>CAREER DIRECTION</span>
                <p className={styles.reportFieldValue}>
                  Software testing, junior developer, technical support.
                </p>
              </div>
            </div>

            {/* Row 2 */}
            <div className={styles.reportGridTwoCol}>
              <div className={styles.reportField}>
                <span className={styles.reportFieldLabel}>SKILL GAP DISCOVERY</span>
                <p className={styles.reportFieldValue}>
                  Data structures practice and clearer project explanations.
                </p>
              </div>
              <div className={styles.reportField}>
                <span className={styles.reportFieldLabel}>COMMUNICATION INSIGHTS</span>
                <p className={styles.reportFieldValue}>
                  Friendly and open. Answers could be more structured.
                </p>
              </div>
            </div>

            {/* Row 3 */}
            <div className={styles.reportGridTwoCol} style={{ marginBottom: '1.5rem' }}>
              <div className={styles.reportField}>
                <span className={styles.reportFieldLabel}>JOB &amp; INTERVIEW READINESS</span>
                <p className={styles.reportFieldValue}>
                  Focus on behavioral answers before applying widely.
                </p>
              </div>
            </div>

            {/* Row 4: Personalized Action Roadmap */}
            <div className={styles.roadmapSection}>
              <span className={styles.reportFieldLabel}>PERSONALIZED ACTION ROADMAP</span>
              <div className={styles.roadmapGrid}>
                <div className={styles.roadmapCard}>
                  <div className={styles.roadmapDays}>30 days</div>
                  <p className={styles.roadmapTask}>
                    Practise explaining two projects out loud.
                  </p>
                </div>
                <div className={styles.roadmapCard}>
                  <div className={styles.roadmapDays}>60 days</div>
                  <p className={styles.roadmapTask}>
                    Strengthen one core skill for your target role.
                  </p>
                </div>
                <div className={styles.roadmapCard}>
                  <div className={styles.roadmapDays}>90 days</div>
                  <p className={styles.roadmapTask}>
                    Complete a mock interview and review progress.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  )
}
