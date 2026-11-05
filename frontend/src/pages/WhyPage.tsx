import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { HrIcon, type HrIconName } from '../components/HrIcon'
import { MarketingNavBar } from '../components/MarketingNavBar'
import { MarketingFooter } from '../components/MarketingFooter'
import { fadeUp, staggerContainer } from '../motion/variants'
import styles from './WhyPage.module.css'

const COMPARISONS = [
  {
    feature: 'Candidate Evaluation Basis',
    legacy: 'Keyword matching on PDFs (easily gamed with ChatGPT)',
    hireright: 'Live spoken video screen with dynamic questions & reasoning',
  },
  {
    feature: 'Screening Turnaround',
    legacy: '7–14 business days of manual recruiter review',
    hireright: 'Instant: 12 minutes to certified multi-dimensional score',
  },
  {
    feature: 'Integrity & Anti-Cheat',
    legacy: 'Zero verification; ghostwriters and proxy interviewers',
    hireright: 'Real-time computer vision proctoring & multi-face detection',
  },
  {
    feature: 'Candidate Experience',
    legacy: 'Ghosted in 95% of applications with zero feedback',
    hireright: 'Actionable scorecard with strengths & growth areas for all',
  },
  {
    feature: 'Recruiter Time per Candidate',
    legacy: '45–60 mins per initial screening phone call',
    hireright: '3 mins reviewing AI summary & timestamped key moments',
  },
]

const PILLARS: { icon: HrIconName; title: string; desc: string }[] = [
  {
    icon: 'target',
    title: 'Capability Over Keywords',
    desc: 'Great engineers aren’t always great resume writers. Ava focuses on how you articulate architecture tradeoffs and solve problems in real-time.',
  },
  {
    icon: 'scale',
    title: 'Bias-Free Standardization',
    desc: 'Every candidate receives the exact same objective rubric across Technical Depth, Communication, Problem Solving, and System Design.',
  },
  {
    icon: 'shield-check',
    title: 'Verified Anti-Cheat Integrity',
    desc: 'Computer vision validates single-person presence and eye gaze to guarantee fairness so honest candidates rise to the top.',
  },
  {
    icon: 'lock',
    title: 'Private & Local First',
    desc: 'Candidate recordings and assessments stay private. Videos are saved securely on local storage and shared only with approved employers.',
  },
]

export function WhyPage() {
  const [candidatesPerMonth, setCandidatesPerMonth] = useState(50)

  const hoursSaved = Math.round(candidatesPerMonth * 0.75)
  const dollarsSaved = Math.round(hoursSaved * 65)

  return (
    <div className={styles.page}>
      <MarketingNavBar />

      <main className={styles.main}>
        {/* HERO */}
        <section className={styles.hero}>
          <motion.div
            className={styles.heroInner}
            initial="hidden"
            animate="show"
            variants={staggerContainer}
          >
            <motion.div className={styles.badge} variants={fadeUp}>
              <HrIcon name="zap" size={14} /> The future of hiring
            </motion.div>
            <motion.h1 className={styles.title} variants={fadeUp}>
              Why HireRighttt?{' '}
              <span className={styles.titleAccent}>The proof is in the interview.</span>
            </motion.h1>
            <motion.p className={styles.subtitle} variants={fadeUp}>
              Resume screening is broken: keyword scanners filter out strong candidates while
              recruiters lose weeks to repetitive first calls. We built a better way to hire.
            </motion.p>
            <motion.div className={styles.heroActions} variants={fadeUp}>
              <Link to="/organizations/signup" className={styles.btnPrimary}>
                Start hiring
              </Link>
              <Link to="/signup" className={styles.btnGhost}>
                I&apos;m a candidate
              </Link>
            </motion.div>
          </motion.div>
        </section>

        <div className={styles.container}>
          {/* PARADIGM */}
          <section className={styles.section}>
            <div className={styles.paradigmGrid}>
              <article className={`${styles.paradigmCard} ${styles.paradigmBad}`}>
                <header className={styles.paradigmHead}>
                  <span className={styles.compareIconBad} aria-hidden>
                    <HrIcon name="close" size={22} />
                  </span>
                  <div>
                    <h3>The broken resume funnel</h3>
                    <span>Legacy keyword ATS filters</span>
                  </div>
                </header>
                <ul>
                  <li><strong>Easily gamed:</strong> keyword stuffing and AI-written bullet points trick scanners.</li>
                  <li><strong>High rejection:</strong> 80% of hands-on engineers are filtered out before an interview.</li>
                  <li><strong>Zero verification:</strong> proxy and ghostwriter risk with unmonitored take-home tests.</li>
                  <li><strong>Recruiter drag:</strong> 45–60 minutes lost per introductory phone screen.</li>
                </ul>
              </article>

              <article className={`${styles.paradigmCard} ${styles.paradigmGood}`}>
                <header className={styles.paradigmHead}>
                  <span className={styles.compareIconGood} aria-hidden>
                    <HrIcon name="check" size={22} strokeWidth={2.5} />
                  </span>
                  <div>
                    <h3>The HireRighttt advantage</h3>
                    <span>Multimodal spoken AI interviews</span>
                  </div>
                </header>
                <ul>
                  <li><strong>Live spoken evaluation:</strong> Ava adapts questions to each candidate&apos;s answers.</li>
                  <li><strong>Integrity proctoring:</strong> computer vision confirms a single, present candidate.</li>
                  <li><strong>Instant scorecard:</strong> a 360° candidate profile and career-readiness score.</li>
                  <li><strong>60% time reclaimed:</strong> review timestamped key moments in about 3 minutes.</li>
                </ul>
              </article>
            </div>
          </section>

          {/* COMPARISON TABLE */}
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <span className={styles.eyebrow}>Side by side</span>
              <h2>Resume boards vs. HireRighttt</h2>
            </div>
            <div className={styles.matrixCard}>
              <table className={styles.matrixTable}>
                <thead>
                  <tr>
                    <th>Evaluation dimension</th>
                    <th>Legacy job boards &amp; ATS</th>
                    <th>HireRighttt AI interviews</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISONS.map((row) => (
                    <tr key={row.feature}>
                      <td>{row.feature}</td>
                      <td>
                        <span className={styles.tableMarkBad}>
                          <HrIcon name="close" size={16} /> <span>{row.legacy}</span>
                        </span>
                      </td>
                      <td>
                        <span className={styles.tableMarkGood}>
                          <HrIcon name="check" size={16} strokeWidth={2.5} /> <span>{row.hireright}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* PILLARS */}
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <span className={styles.eyebrow}>Our core values</span>
              <h2>Built on four pillars of integrity</h2>
            </div>
            <div className={styles.pillarsGrid}>
              {PILLARS.map((p) => (
                <div key={p.title} className={styles.pillarCard}>
                  <div className={styles.pillarIcon}>
                    <HrIcon name={p.icon} size={26} />
                  </div>
                  <h3>{p.title}</h3>
                  <p>{p.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ROI */}
          <section className={styles.section}>
            <div className={styles.roiCard}>
              <div className={styles.sectionHead}>
                <span className={styles.eyebrow}>Recruiter time &amp; cost savings</span>
                <h2>Calculate your monthly ROI</h2>
              </div>

              <div className={styles.roiGrid}>
                <div className={styles.roiControl}>
                  <label htmlFor="roi-candidates">
                    Monthly candidates screened: <strong>{candidatesPerMonth}</strong>
                  </label>
                  <input
                    id="roi-candidates"
                    type="range"
                    min="10"
                    max="300"
                    step="5"
                    value={candidatesPerMonth}
                    onChange={(e) => setCandidatesPerMonth(Number(e.target.value))}
                    className={styles.roiSlider}
                  />
                  <p className={styles.roiNote}>
                    Based on an average of 45 minutes saved per candidate screen and a $65/hr recruiter cost.
                  </p>
                </div>

                <div className={styles.roiDisplayBox}>
                  <div className={styles.roiStat}>
                    <span>Recruiter hours reclaimed</span>
                    <strong>{hoursSaved} hrs / mo</strong>
                  </div>
                  <div className={styles.roiStat}>
                    <span>Estimated cost savings</span>
                    <strong>${dollarsSaved.toLocaleString()} / mo</strong>
                  </div>
                  <div className={styles.roiStat}>
                    <span>Time-to-hire reduction</span>
                    <strong>60% faster</strong>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* CTA */}
          <section className={styles.section}>
            <div className={styles.cta}>
              <h2>Experience the difference first-hand</h2>
              <p>Try an AI interview as a candidate, or set up your hiring workspace in minutes.</p>
              <div className={styles.heroActions}>
                <Link to="/signup" className={styles.btnPrimary}>
                  Take a sample interview
                </Link>
                <Link to="/organizations/signup" className={styles.btnGhost}>
                  Create organization account
                </Link>
              </div>
            </div>
          </section>
        </div>
      </main>

      <MarketingFooter />
    </div>
  )
}
