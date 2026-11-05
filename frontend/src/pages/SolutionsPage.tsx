import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { MarketingNavBar } from '../components/MarketingNavBar'
import { MarketingFooter } from '../components/MarketingFooter'
import styles from './SolutionsPage.module.css'
import { fadeUp, staggerContainer } from '../motion/variants'

// 4 main solution cards matching reference image with neon circular icons
const SOLUTION_CARDS = [
  {
    id: 'staffing',
    category: 'Staffing & Recruitment',
    iconType: 'orange',
    title: 'Staffing & Recruitment Agencies',
    desc: 'Manage multiple clients, jobs, and candidates in one place. Improve submission rates and deliver better matches faster.',
    link: '/signup',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    id: 'enterprise',
    category: 'Enterprise Hiring',
    iconType: 'purple',
    title: 'Enterprise Hiring Teams',
    desc: 'Streamline high-volume hiring with structured workflows, approvals, and advanced analytics.',
    link: '/signup',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
        <line x1="9" y1="6" x2="9" y2="6.01" />
        <line x1="15" y1="6" x2="15" y2="6.01" />
        <line x1="9" y1="10" x2="9" y2="10.01" />
        <line x1="15" y1="10" x2="15" y2="10.01" />
        <line x1="9" y1="14" x2="9" y2="14.01" />
        <line x1="15" y1="14" x2="15" y2="14.01" />
        <path d="M10 22v-4h4v4" />
      </svg>
    ),
  },
  {
    id: 'campus',
    category: 'Campus Hiring',
    iconType: 'blue',
    title: 'Campus Hiring Solutions',
    desc: 'Engage talent early, conduct assessments, and build a strong pipeline of future-ready professionals.',
    link: '/signup',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
        <path d="M6 12v5c3 3 9 3 12 0v-5" />
      </svg>
    ),
  },
  {
    id: 'diversity',
    category: 'Diversity Hiring',
    iconType: 'cyan',
    title: 'Diversity & Inclusion Hiring',
    desc: 'Build diverse teams with inclusive hiring workflows and unbiased AI-powered candidate matching.',
    link: '/signup',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
        <line x1="9" y1="9" x2="9.01" y2="9" />
        <line x1="15" y1="9" x2="15.01" y2="9" />
      </svg>
    ),
  },
]

// "Why HireRighttt" feature list with images from public/Solutions
const WHY_FEATURES = [
  {
    id: 'interviews',
    title: 'AI-Powered Interviews',
    desc: 'Conduct live and async AI interviews with real-time skill evaluation.',
    image: '/Solutions/AI Interview.png',
    alt: 'AI Interview in Action',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="22" />
      </svg>
    ),
  },
  {
    id: 'resume',
    title: 'Intelligent Resume Scanning',
    desc: 'Extract, parse and rank resumes automatically with 95%+ accuracy.',
    image: '/Solutions/Intelligent.png',
    alt: 'Intelligent Resume Scanning',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    id: 'workflows',
    title: 'Automated Workflows',
    desc: 'Reduce manual work with smart automations and approvals.',
    image: '/Solutions/Automated.png',
    alt: 'Automated Workflows',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    id: 'analytics',
    title: 'Advanced Analytics',
    desc: 'Track performance, pipeline health, and hiring metrics.',
    image: '/Solutions/Advanced.png',
    alt: 'Advanced Analytics',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
]

// Metrics items using vector SVGs
const METRICS = [
  {
    value: '40%',
    label: 'Faster Time-to-Hire',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  },
  {
    value: '60%',
    label: 'Better Candidate Quality',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    value: '50%',
    label: 'Reduction in Manual Work',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
  {
    value: '30%',
    label: 'Increase in Submission Rate',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    ),
  },
]

// Testimonials with SVG stars
const TESTIMONIALS = [
  {
    quote:
      'HireRighttt has completely transformed how we manage our recruitment pipeline. The AI matching is incredibly accurate and saves us hours every day.',
    name: 'Priya Nair',
    role: 'Head of Talent Acquisition',
    company: 'Infosys',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=120&h=120&fit=crop&crop=faces',
  },
  {
    quote:
      'The automation and reporting features give us complete visibility into our hiring process. It\'s a must-have for any growing recruitment team.',
    name: 'Rohit Singh',
    role: 'Recruitment Manager',
    company: 'TCS',
    avatar: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=120&h=120&fit=crop&crop=faces',
  },
  {
    quote:
      'We\'ve seen a 35% increase in submission rates since we started using HireRighttt. The platform is intuitive and the support team is fantastic.',
    name: 'Anita Kapoor',
    role: 'Delivery Head - Staffing',
    company: 'Wipro',
    avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=120&h=120&fit=crop&crop=faces',
  },
]

// Feature Badges with clean SVG icons (NO EMOJIS)
const BADGES = [
  {
    label: 'End-to-End Platform',
    icon: (
      <svg className={styles.pillIconSvg} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
  },
  {
    label: 'Scalable & Secure',
    icon: (
      <svg className={styles.pillIconSvg} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
  {
    label: 'Customizable Workflows',
    icon: (
      <svg className={styles.pillIconSvg} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="4" y1="21" x2="4" y2="14" />
        <line x1="4" y1="10" x2="4" y2="3" />
        <line x1="12" y1="21" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12" y2="3" />
        <line x1="20" y1="21" x2="20" y2="16" />
        <line x1="20" y1="12" x2="20" y2="3" />
        <line x1="1" y1="14" x2="7" y2="14" />
        <line x1="9" y1="8" x2="15" y2="8" />
        <line x1="17" y1="16" x2="23" y2="16" />
      </svg>
    ),
  },
  {
    label: 'Seamless Integrations',
    icon: (
      <svg className={styles.pillIconSvg} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 2 7 12 12 22 7 12 2" />
        <polyline points="2 17 12 22 22 17" />
        <polyline points="2 12 12 17 22 12" />
      </svg>
    ),
  },
  {
    label: 'Dedicated Support',
    icon: (
      <svg className={styles.pillIconSvg} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
      </svg>
    ),
  },
]

export function SolutionsPage() {
  const [activeWhy, setActiveWhy] = useState('interviews')
  const [ctaMousePos, setCtaMousePos] = useState({ x: 0, y: 0 })
  const [ctaHovered, setCtaHovered] = useState(false)

  const handleCtaMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setCtaMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })
  }

  const activeWhyData = WHY_FEATURES.find((f) => f.id === activeWhy) || WHY_FEATURES[0]

  return (
    <div className={styles.page}>
      {/* Ambient Radial Glows */}
      <div className={styles.bgGlowContainer}>
        <div className={styles.glowTopCenter} />
        <div className={styles.glowMiddleRight} />
        <div className={styles.glowBottomLeft} />
      </div>

      {/* Navigation in 85% Shell */}
      <div className={styles.shell}>
        <MarketingNavBar />
      </div>

      {/* Hero Section */}
      <div className={styles.shell}>
        <section className={styles.heroSection}>
          <motion.div
            className={styles.heroContent}
            initial="initial"
            animate="animate"
            variants={staggerContainer}
          >
            <motion.div className={styles.kickerPill} variants={fadeUp}>
              <span>HOW IT WORKS</span>
            </motion.div>

            <motion.h1 className={styles.heroTitle} variants={fadeUp}>
              How HireRighttt <br />
              <span className={styles.highlightText}>works for modern</span> hiring teams
            </motion.h1>

            <motion.p className={styles.heroSubtitle} variants={fadeUp}>
              HireRighttt helps staffing and recruitment teams streamline every step of the hiring
              process with AI-powered matching, automation, and intelligent insights.
            </motion.p>

            <motion.div className={styles.heroActions} variants={fadeUp}>
              <Link to="/signup" className={styles.btnPrimary}>
                Explore Solutions <span>→</span>
              </Link>
              <Link to="/signup" className={styles.btnSecondary}>
                Book a Demo
              </Link>
            </motion.div>
          </motion.div>

          {/* Hero Studio Interactive Graphic */}
          <motion.div
            className={styles.studioCardWrapper}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <div className={styles.studioCard}>
              <div className={styles.studioCardHeader}>
                <div className={styles.studioTitle}>AI Interview Studio</div>
                <div className={styles.liveBadge}>
                  <span className={styles.liveDot} />
                  Live
                </div>
              </div>

              <div className={styles.studioBody}>
                {/* Left checklist */}
                <div className={styles.analysisBox}>
                  <div className={styles.analysisTitle}>Real-time Analysis</div>
                  <ul className={styles.analysisList}>
                    <li className={styles.analysisItem}>
                      <svg className={styles.checkIcon} viewBox="0 0 16 16" fill="none">
                        <path d="M13.333 4L6 11.333 2.667 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Technical Skills
                    </li>
                    <li className={styles.analysisItem}>
                      <svg className={styles.checkIcon} viewBox="0 0 16 16" fill="none">
                        <path d="M13.333 4L6 11.333 2.667 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Communication
                    </li>
                    <li className={styles.analysisItem}>
                      <svg className={styles.checkIcon} viewBox="0 0 16 16" fill="none">
                        <path d="M13.333 4L6 11.333 2.667 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Problem Solving
                    </li>
                    <li className={styles.analysisItem}>
                      <svg className={styles.checkIcon} viewBox="0 0 16 16" fill="none">
                        <path d="M13.333 4L6 11.333 2.667 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Behavioral Fit
                    </li>
                    <li className={styles.analysisItem}>
                      <svg className={styles.checkIcon} viewBox="0 0 16 16" fill="none">
                        <path d="M13.333 4L6 11.333 2.667 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Role Compatibility
                    </li>
                  </ul>
                </div>

                {/* Center hologram face display */}
                <div className={styles.avatarDisplay}>
                  <div className={styles.avatarGraphic}>
                    <div className={styles.orbitRing} />
                    <div className={styles.aiHeadMesh}>
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#00f0ff" strokeWidth="1.5">
                        <path d="M12 2a8 8 0 0 0-8 8c0 5.25 7 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z" />
                        <circle cx="12" cy="9" r="3" />
                      </svg>
                    </div>
                  </div>

                  <div className={styles.soundwaveContainer}>
                    <div className={styles.waveBar} style={{ animationDelay: '0s' }} />
                    <div className={styles.waveBar} style={{ animationDelay: '0.2s' }} />
                    <div className={styles.waveBar} style={{ animationDelay: '0.4s' }} />
                    <div className={styles.waveBar} style={{ animationDelay: '0.1s' }} />
                    <div className={styles.waveBar} style={{ animationDelay: '0.3s' }} />
                    <div className={styles.waveBar} style={{ animationDelay: '0.5s' }} />
                  </div>

                  <button type="button" className={styles.micButton} aria-label="Microphone active">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    </svg>
                  </button>
                </div>

                {/* Right score gauge */}
                <div className={styles.insightsBox}>
                  <div className={styles.insightsTitle}>Interview Insights</div>
                  <div className={styles.scoreGauge}>
                    <svg className={styles.scoreGaugeSvg} viewBox="0 0 36 36">
                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="rgba(255, 255, 255, 0.1)"
                        strokeWidth="3.5"
                      />
                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="url(#blueGauge)"
                        strokeWidth="3.5"
                        strokeDasharray="92, 100"
                        strokeLinecap="round"
                      />
                      <defs>
                        <linearGradient id="blueGauge" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#00f0ff" />
                          <stop offset="100%" stopColor="#3b82f6" />
                        </linearGradient>
                      </defs>
                    </svg>
                    <div className={styles.scoreText}>
                      <span className={styles.scoreVal}>92%</span>
                      <span className={styles.scoreSub}>Overall Fit</span>
                    </div>
                  </div>

                  <div className={styles.recommendBadge}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="#2563eb" stroke="none">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                    <span>
                      Strong candidate! <br /> Recommended for next round
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </section>
      </div>

      {/* Solutions Grid Section WITH NEON GLOW CONTAINER */}
      <div className={styles.shell}>
        <section className={styles.tabbedSection}>
          <div className={styles.solutionsOuterContainer}>
            <h2 className={styles.sectionHeading}>Solutions for every hiring need</h2>

            <div className={styles.solutionsGrid}>
              {SOLUTION_CARDS.map((card) => {
                const iconClass =
                  card.iconType === 'orange'
                    ? styles.iconOrange
                    : card.iconType === 'purple'
                    ? styles.iconPurple
                    : card.iconType === 'blue'
                    ? styles.iconBlue
                    : styles.iconCyan

                return (
                  <motion.div
                    key={card.id}
                    className={styles.solutionCard}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <div>
                      <div className={`${styles.cardIcon} ${iconClass}`}>{card.icon}</div>
                      <h3 className={styles.cardTitle}>{card.title}</h3>
                      <p className={styles.cardDesc}>{card.desc}</p>
                    </div>
                    <Link to={card.link} className={styles.cardLink}>
                      Explore Solution <span>→</span>
                    </Link>
                  </motion.div>
                )
              })}
            </div>
          </div>
        </section>
      </div>

      {/* Why HireRighttt Showcase with dynamic side image from public/Solutions */}
      <div className={styles.shell}>
        <section className={styles.whySection}>
          <div className={styles.whyHeader}>
            <div className={styles.whyKicker}>WHY HireRighttt</div>
            <h2 className={styles.whyTitle}>Everything you need to hire the right talent</h2>
          </div>

          <div className={styles.whyGrid}>
            {/* Left interactive selector list */}
            <div className={styles.whyList}>
              {WHY_FEATURES.map((feat) => {
                const isActive = activeWhy === feat.id
                return (
                  <div
                    key={feat.id}
                    className={`${styles.whyItem} ${isActive ? styles.whyItemActive : ''}`}
                    onClick={() => setActiveWhy(feat.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setActiveWhy(feat.id)}
                  >
                    <div className={styles.itemIconWrapper}>{feat.icon}</div>
                    <div className={styles.itemText}>
                      <div className={styles.itemTitle}>{feat.title}</div>
                      <div className={styles.itemDesc}>{feat.desc}</div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Right dynamic image display frame */}
            <div className={styles.whyVisualCard}>
              <AnimatePresence mode="wait">
                <motion.img
                  key={activeWhyData.id}
                  src={activeWhyData.image}
                  alt={activeWhyData.alt}
                  className={styles.whyFeatureImg}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.35, ease: 'easeOut' }}
                />
              </AnimatePresence>
            </div>
          </div>
        </section>
      </div>

      {/* Metrics Section */}
      <div className={styles.shell}>
        <section className={styles.metricsSection}>
          <div className={styles.metricsGrid}>
            {METRICS.map((m) => (
              <div key={m.label} className={styles.metricCard}>
                <div className={styles.metricIcon}>{m.icon}</div>
                <div>
                  <div className={styles.metricValue}>{m.value}</div>
                  <div className={styles.metricLabel}>{m.label}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Testimonials */}
      <div className={styles.shell}>
        <section className={styles.testimonialsSection}>
          <h2 className={styles.sectionHeading}>Loved by recruiters, trusted by companies</h2>

          <div className={styles.testimonialsGrid}>
            {TESTIMONIALS.map((item) => (
              <div key={item.name} className={styles.testimonialCard}>
                <p className={styles.quoteText}>"{item.quote}"</p>
                <div className={styles.authorMeta}>
                  <img src={item.avatar} alt={item.name} className={styles.authorAvatar} />
                  <div className={styles.authorDetails}>
                    <span className={styles.authorName}>{item.name}</span>
                    <span className={styles.authorRole}>
                      {item.role} - {item.company}
                    </span>
                  </div>
                </div>
                <div className={styles.starRating}>
                  {[...Array(5)].map((_, i) => (
                    <svg key={i} className={styles.starSvg} viewBox="0 0 24 24">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Feature Badges Row */}
      <div className={styles.shell}>
        <section className={styles.badgesRow}>
          {BADGES.map((b) => (
            <div key={b.label} className={styles.featurePill}>
              {b.icon}
              <span>{b.label}</span>
            </div>
          ))}
        </section>
      </div>

      {/* CTA Banner with cursor-following orange glow */}
      <div className={styles.shell}>
        <section className={styles.ctaSection}>
          <div
            className={styles.ctaCard}
            onMouseMove={handleCtaMouseMove}
            onMouseEnter={() => setCtaHovered(true)}
            onMouseLeave={() => setCtaHovered(false)}
          >
            <div className={styles.ctaLeft}>
              <div className={styles.ctaIconContainer}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <div>
                <h2 className={styles.ctaTitle}>Ready to transform your hiring?</h2>
                <p className={styles.ctaDesc}>
                  Join thousands of recruitment teams who trust HireRighttt to find and hire the best
                  talent, faster.
                </p>
              </div>
            </div>

            <div className={styles.ctaRight}>
              <Link to="/signup" className={styles.btnPrimary}>
                Get Started Free
              </Link>
              <Link to="/signup" className={styles.btnSecondary}>
                Book a Demo
              </Link>
            </div>

            <motion.div
              className={styles.ctaCursorGlow}
              animate={{
                x: ctaMousePos.x - 160,
                y: ctaMousePos.y - 160,
                opacity: ctaHovered ? 1 : 0,
              }}
              transition={{ type: 'spring', damping: 25, stiffness: 220, mass: 0.3 }}
            />
          </div>
        </section>
      </div>

      <MarketingFooter />
    </div>
  )
}
