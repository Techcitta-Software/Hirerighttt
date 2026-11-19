import { Link } from 'react-router-dom'
import { HrIcon } from '../components/HrIcon'
import { MarketingNavBar } from '../components/MarketingNavBar'
import { MarketingFooter } from '../components/MarketingFooter'
import styles from './PricingPage.module.css'

const PLANS = [
  {
    name: 'Job Seeker Free',
    desc: 'For individual candidates looking to interview, practice, and prove skills.',
    price: '$0',
    period: 'forever free',
    popular: false,
    ctaText: 'Start Interview Free →',
    ctaLink: '/signup',
    ctaStyle: 'secondary',
    features: [
      'Unlimited AI practice interviews with Ava',
      'Instant resume parsing & skill extraction',
      'AI Talent & resume-fit scorecard',
      'Apply to ranked top match jobs',
      'Local private video recording storage',
    ],
  },
  {
    name: 'Pro Recruiter & ATS',
    desc: 'For startups, hiring managers, and recruiting teams hiring top talent faster.',
    price: '$49',
    period: '/ month',
    popular: true,
    ctaText: 'Start 14-Day Free Trial →',
    ctaLink: '/signup',
    ctaStyle: 'primary',
    features: [
      'Everything in Candidate Free',
      'Create unlimited private job openings',
      'Custom Job Description (JD) AI interviews',
      'Shareable assessment invite links (/apply/code)',
      'Real-time anti-cheat proctoring & behavior timeline',
      'Interactive video player with red violation markers',
      'Applicant pipeline tracking & AI rankings',
    ],
  },
  {
    name: 'Enterprise Agency',
    desc: 'For high-volume staffing firms and enterprise recruitment operations.',
    price: '$199',
    period: '/ month',
    popular: false,
    ctaText: 'Contact Enterprise Sales →',
    ctaLink: '/contact',
    ctaStyle: 'secondary',
    features: [
      'Everything in Pro Recruiter',
      'Dedicated LLM fine-tuning for your company',
      'Custom ATS integrations (Workday, Greenhouse)',
      'Multi-team recruiter workspaces & permissions',
      'Full API access & webhook event streaming',
      'Dedicated account manager & 99.9% uptime SLA',
    ],
  },
]

export function PricingPage() {
  return (
    <div className={styles.page}>
      <MarketingNavBar />
      <main className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.kicker}>
            TRANSPARENT PRICING
          </div>
          <h1 className={styles.title}>
            Hire the best. <em>Priced for everyone.</em>
          </h1>
          <p className={styles.subtitle}>
            Whether you are a job seeker proving your skills or an employer screening hundreds of candidates, HireRighttt has the right plan for you.
          </p>
        </header>

        <div className={styles.grid}>
          {PLANS.map((plan) => (
            <div key={plan.name} className={`${styles.card} ${plan.popular ? styles.popularCard : ''}`}>
              {plan.popular && <div className={styles.popularBadge}>Most Popular</div>}
              <h2 className={styles.planName}>{plan.name}</h2>
              <p className={styles.planDesc}>{plan.desc}</p>
              <div className={styles.priceBox}>
                <span className={styles.price}>{plan.price}</span>
                <span className={styles.period}>{plan.period}</span>
              </div>
              <ul className={styles.featureList}>
                {plan.features.map((feat) => (
                  <li key={feat} className={styles.featureItem}>
                    <span className={styles.checkIcon} aria-hidden>
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
      </main>
      <MarketingFooter />
    </div>
  )
}
