import { useState } from 'react'
import { Link } from 'react-router-dom'
import { HrIcon } from '../components/HrIcon'
import { MarketingNavBar } from '../components/MarketingNavBar'
import { MarketingFooter } from '../components/MarketingFooter'
import styles from './PricingPage.module.css'

interface PlanTier {
  id: string
  name: string
  badge?: string
  popular?: boolean
  desc: string
  price: string
  currency: string
  period: string
  highlight?: string
  features: string[]
  ctaText: string
  ctaLink: string
  ctaStyle: 'primary' | 'secondary'
}

const PRICING_PLANS: PlanTier[] = [
  {
    id: 'starter',
    name: 'Free Starter',
    desc: 'For individual job seekers looking to parse their resume and test the waters.',
    currency: '₹',
    price: '0',
    period: 'forever free',
    features: [
      'Instant resume parsing & skill extraction',
      'Basic AI interview practice session',
      'Career direction & skill gap preview',
      'Standard interview tips & role recommendations',
      '100% private & secure data storage',
    ],
    ctaText: 'Start Free Practice →',
    ctaLink: '/signup',
    ctaStyle: 'secondary',
  },
  {
    id: 'candidate-retake',
    name: '360° AI Interview / Retake Credit',
    badge: 'Most Popular',
    popular: true,
    desc: 'Full scored AI interview with Ava, 360° intelligence report, and verified integrity badge.',
    currency: '₹',
    price: '89',
    period: '/ scored interview',
    highlight: 'One-time fee · Refreshes application ranking',
    features: [
      'Full 15-minute voice interview with Ava AI',
      'Comprehensive 360° candidate scorecard (PDF download)',
      'Verified anti-cheat integrity & proctoring report',
      'Personalized strengths, skill gaps & 30-60-90 day action plan',
      'Automatic matching with top recruiter job openings',
      'Unlimited scorecard sharing with prospective employers',
    ],
    ctaText: 'Take AI Interview (₹89) →',
    ctaLink: '/signup',
    ctaStyle: 'primary',
  },
  {
    id: 'recruiter-pack',
    name: 'Recruiter & Organization Pack',
    badge: 'Pay-As-You-Go',
    desc: 'For hiring managers and teams screening candidates with automated AI interviews.',
    currency: '₹',
    price: '89',
    period: '/ interview credit',
    highlight: '50-pack at ₹4,450 · Credits never expire',
    features: [
      'Custom Job Description (JD) AI interview configuration',
      'Shareable candidate assessment links (/apply/code)',
      'Real-time anti-cheat timeline with violation markers',
      'Side-by-side applicant ranking & comparative benchmarks',
      'Multi-seat recruiter collaboration & exportable PDF scorecards',
      'Instant ATS webhook integration & dedicated support',
    ],
    ctaText: 'Start Hiring with Pack →',
    ctaLink: '/organizations/signup',
    ctaStyle: 'secondary',
  },
]

const GUARANTEES = [
  {
    icon: 'shield-check' as const,
    title: 'No Hidden Fees',
    desc: 'Straightforward ₹89 per interview. No unexpected monthly subscription traps or surprise renewals.',
  },
  {
    icon: 'lock' as const,
    title: 'Secure UPI & Razorpay',
    desc: 'Instant, encrypted checkout with Google Pay, PhonePe, Paytm, RuPay, Visa, Mastercard, and NetBanking.',
  },
  {
    icon: 'zap' as const,
    title: '100% Money-Back Guarantee',
    desc: 'If technical glitches disrupt your AI session or report generation, your credit is immediately restored or refunded.',
  },
]

const FAQS = [
  {
    q: 'Why ₹89 per interview? Are there any subscriptions?',
    a: 'No subscriptions required! We believe high-quality AI interview preparation and candidate evaluation should be accessible to everyone. Job seekers pay ₹89 only when they take or retake a full scored interview. Organizations can purchase pay-as-you-go interview credits at the same ₹89/interview rate or bulk packs.',
  },
  {
    q: 'Can I retake the interview if I want to improve my score?',
    a: 'Yes! If you feel you can present your skills better, you can purchase an interview retake for ₹89. Ava will adapt follow-up questions, generate a refreshed 360° scorecard, and update your ranking across employer applications.',
  },
  {
    q: 'How long is my 360° interview scorecard valid?',
    a: 'Your scorecard and verified integrity report remain active and shareable indefinitely in your candidate dashboard. When applying to new jobs on HireRighttt, employers receive your most recent verified scorecard.',
  },
  {
    q: 'What payment methods do you support?',
    a: 'We support all major Indian payment options via Razorpay: UPI (Google Pay, PhonePe, Paytm, BHIM), debit/credit cards (Visa, Mastercard, RuPay), NetBanking, and popular digital wallets.',
  },
  {
    q: 'Do recruiter interview credits ever expire?',
    a: 'No, recruiter interview credits never expire. Purchase a 50-pack (₹4,450) or custom high-volume hiring pack and utilize credits whenever you launch new job openings.',
  },
  {
    q: 'Can organizations request custom volume pricing?',
    a: 'Yes, if you interview hundreds of candidates monthly or need custom ATS integrations, contact our sales team at support@hirerighttt.com for tailored enterprise terms.',
  },
]

export function PricingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  const toggleFaq = (index: number) => {
    setOpenFaq((prev) => (prev === index ? null : index))
  }

  return (
    <div className={styles.page}>
      <MarketingNavBar />
      <main className={styles.shell}>
        <div className={styles.hero}>
        <header className={styles.header}>
          <div className={styles.kicker}>TRANSPARENT & AFFORDABLE</div>
          <h1 className={styles.title}>
            Simple, honest pricing. <em>₹89 per interview.</em>
          </h1>
          <p className={styles.subtitle}>
            Pay only for what you use. Whether you&apos;re an ambitious candidate proving your talent or an organization
            screening 500+ applicants, get comprehensive 360° intelligence without pricey subscriptions.
          </p>
        </header>

        {/* Pricing Cards Grid */}
        <div className={styles.grid}>
          {PRICING_PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`${styles.card} ${plan.popular ? styles.popularCard : ''}`}
            >
              {plan.badge && (
                <div className={`${styles.badge} ${plan.popular ? styles.popularBadge : styles.neutralBadge}`}>
                  {plan.badge}
                </div>
              )}
              <h2 className={styles.planName}>{plan.name}</h2>
              <p className={styles.planDesc}>{plan.desc}</p>

              <div className={styles.priceBox}>
                <div className={styles.priceRow}>
                  <span className={styles.currency}>{plan.currency}</span>
                  <span className={styles.price}>{plan.price}</span>
                  <span className={styles.period}>{plan.period}</span>
                </div>
                {plan.highlight && <div className={styles.highlightText}>{plan.highlight}</div>}
              </div>

              <div className={styles.featuresHeader}>Includes:</div>
              <ul className={styles.featureList}>
                {plan.features.map((feat) => (
                  <li key={feat} className={styles.featureItem}>
                    <span className={styles.checkIcon} aria-hidden="true">
                      <HrIcon name="check" size={16} strokeWidth={2.5} />
                    </span>
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>

              <Link
                to={plan.ctaLink}
                className={`${styles.ctaBtn} ${plan.ctaStyle === 'primary' ? styles.ctaPrimary : styles.ctaSecondary}`}
              >
                {plan.ctaText}
              </Link>
            </div>
          ))}
        </div>
        </div>

        {/* Guarantees Strip */}
        <section className={styles.guaranteesSection} aria-labelledby="guarantees-title">
          <h2 id="guarantees-title" className={styles.sectionHeading}>
            Our transparent guarantees
          </h2>
          <div className={styles.guaranteesGrid}>
            {GUARANTEES.map((item) => (
              <div key={item.title} className={styles.guaranteeCard}>
                <div className={styles.guaranteeIcon}>
                  <HrIcon name={item.icon} size={24} strokeWidth={2} />
                </div>
                <h3 className={styles.guaranteeTitle}>{item.title}</h3>
                <p className={styles.guaranteeDesc}>{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ Accordion */}
        <section className={styles.faqSection} aria-labelledby="faq-title">
          <div className={styles.faqHeader}>
            <div className={styles.kicker}>GOT QUESTIONS?</div>
            <h2 id="faq-title" className={styles.sectionHeading}>
              Frequently Asked Questions
            </h2>
            <p className={styles.faqSubtitle}>
              Everything you need to know about interview scoring, validity, retakes, and payment security.
            </p>
          </div>

          <div className={styles.faqList}>
            {FAQS.map((faq, index) => {
              const isOpen = openFaq === index
              return (
                <div key={faq.q} className={`${styles.faqItem} ${isOpen ? styles.faqOpen : ''}`}>
                  <button
                    type="button"
                    className={styles.faqQuestionBtn}
                    onClick={() => toggleFaq(index)}
                    aria-expanded={isOpen}
                    aria-controls={`faq-answer-${index}`}
                  >
                    <span className={styles.faqQuestion}>{faq.q}</span>
                    <span className={`${styles.faqChevron} ${isOpen ? styles.chevronRotated : ''}`} aria-hidden="true">
                      <HrIcon name="arrow-right" size={16} />
                    </span>
                  </button>
                  {isOpen && (
                    <div id={`faq-answer-${index}`} className={styles.faqAnswer}>
                      <p>{faq.a}</p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* Enterprise / Support banner */}
        <div className={styles.helpBanner}>
          <div>
            <h3>Need a custom package or high-volume interview workflow?</h3>
            <p>Our team works with colleges, recruitment agencies, and enterprises across India.</p>
          </div>
          <Link to="/contact" className={styles.helpBannerBtn}>
            Talk to Enterprise Team →
          </Link>
        </div>
      </main>
      <MarketingFooter />
    </div>
  )
}
