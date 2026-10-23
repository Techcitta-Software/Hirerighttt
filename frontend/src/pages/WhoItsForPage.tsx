import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { MarketingNavBar } from '../components/MarketingNavBar'
import { MarketingFooter } from '../components/MarketingFooter'
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
  return (
    <div className={styles.page}>
      <MarketingNavBar />

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
          >Who It’s For</motion.p>

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

      <MarketingFooter />
    </div>
  )
}
