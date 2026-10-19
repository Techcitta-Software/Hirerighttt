import { Link } from 'react-router-dom'
import type { WizardStep } from '../data/wizard'
import { BrandLogo } from './BrandLogo'
import styles from './Sidebar.module.css'

const WHY_ITEMS = [
  'AI-powered matching with the right roles',
  'Verified by top employers globally',
  '100% secure & privacy-first',
  'Helping talent grow, one connection at a time',
]
const CONFIRM_ITEMS = [
  'AI-Powered Matching',
  'Fair & Unbiased',
  'Trusted by Top Companies',
  '100% Secure & Private',
]

export function Sidebar({ step = 1 }: { step?: WizardStep }) {
  const later = step >= 4

  return (
    <aside className={`${styles.sidebar} ${later ? styles.later : ''}`} aria-label="HireRight introduction">
      {/* Background constellation network */}
      <svg className={styles.constellation} viewBox="0 0 320 380" fill="none" aria-hidden="true">
        <line x1="28" y1="78" x2="105" y2="35" stroke="#7952f5" strokeOpacity="0.22" strokeWidth="1" />
        <line x1="105" y1="35" x2="200" y2="28" stroke="#7952f5" strokeOpacity="0.22" strokeWidth="1" />
        <line x1="200" y1="28" x2="278" y2="72" stroke="#7952f5" strokeOpacity="0.22" strokeWidth="1" />
        <line x1="105" y1="35" x2="160" y2="148" stroke="#7952f5" strokeOpacity="0.18" strokeWidth="1" />
        <line x1="200" y1="28" x2="252" y2="162" stroke="#7952f5" strokeOpacity="0.2" strokeWidth="1" />
        <line x1="278" y1="72" x2="252" y2="162" stroke="#7952f5" strokeOpacity="0.22" strokeWidth="1" />
        <line x1="252" y1="162" x2="288" y2="275" stroke="#7952f5" strokeOpacity="0.18" strokeWidth="1" />
        <line x1="160" y1="148" x2="252" y2="162" stroke="#7952f5" strokeOpacity="0.16" strokeWidth="1" />
        <line x1="160" y1="148" x2="124" y2="228" stroke="#7952f5" strokeOpacity="0.15" strokeWidth="1" />
        <line x1="124" y1="228" x2="265" y2="315" stroke="#7952f5" strokeOpacity="0.15" strokeWidth="1" />
        <line x1="252" y1="162" x2="265" y2="315" stroke="#7952f5" strokeOpacity="0.2" strokeWidth="1" />

        <circle cx="28" cy="78" r="3.5" fill="#7952f5" fillOpacity="0.35" />
        <circle cx="105" cy="35" r="4" fill="#6d42f8" fillOpacity="0.45" />
        <circle cx="200" cy="28" r="3.5" fill="#7952f5" fillOpacity="0.35" />
        <circle cx="278" cy="72" r="4.5" fill="#6d42f8" fillOpacity="0.45" />
        <circle cx="160" cy="148" r="4" fill="#7952f5" fillOpacity="0.4" />
        <circle cx="252" cy="162" r="4.5" fill="#6d42f8" fillOpacity="0.5" />
        <circle cx="124" cy="228" r="3.5" fill="#7952f5" fillOpacity="0.3" />
        <circle cx="288" cy="275" r="4" fill="#7952f5" fillOpacity="0.35" />
        <circle cx="265" cy="315" r="4" fill="#6d42f8" fillOpacity="0.4" />
      </svg>

      <div style={{ marginBottom: '1.25rem', position: 'relative', zIndex: 2 }}>
        <BrandLogo size="lg" />
      </div>

      {later && (
        <div
          className={`${styles.character} ${step === 5 ? styles.confirmCharacter : ''}`}
          role="img"
          aria-label="A professional with a laptop sitting in a purple chair"
        />
      )}

      <div className={styles.hero}>
        <h2>
          {step === 5 ? (
            <>
              You're on the
              <br />
              <span className={styles.redWord}>Right</span> Path!
            </>
          ) : step === 4 ? (
            <>
              You've taken
              <br />
              the <span className={styles.redWord}>Right</span> Step!
            </>
          ) : (
            <>
              Your Journey
              <br />
              to the <span className={styles.redWord}>Right</span>
              <br />
              Opportunity
              <br />
              Starts Here.
            </>
          )}
        </h2>
        <p>
          {step === 5
            ? "We're excited to have you with us. Our AI interview will help you showcase your skills and connect you with the best opportunities."
            : step === 4
              ? "We're excited to learn more about you and help you connect with the right opportunities."
              : "We're here to understand you better, so we can connect you with opportunities that truly fit your potential."}
        </p>
      </div>

      {!later && (
        <div className={styles.featureCard}>
          <svg className={styles.featureCardSvg} viewBox="0 0 280 160" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="sidebarCardSky" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#15173c" />
                <stop offset="50%" stopColor="#1e224e" />
                <stop offset="78%" stopColor="#3d2a58" />
                <stop offset="100%" stopColor="#7a4666" />
              </linearGradient>
              <radialGradient id="sidebarCardSun" cx="75%" cy="66%" r="28%">
                <stop offset="0%" stopColor="#fab197" stopOpacity="0.95" />
                <stop offset="50%" stopColor="#e4827d" stopOpacity="0.65" />
                <stop offset="100%" stopColor="#3d2a58" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect width="280" height="160" fill="url(#sidebarCardSky)" />
            <circle cx="210" cy="98" r="28" fill="url(#sidebarCardSun)" />
            <circle cx="210" cy="98" r="14" fill="#fed6c3" />
            <polygon points="35,160 110,95 190,160" fill="#2d254d" opacity="0.85" />
            <polygon points="0,160 28,126 85,160" fill="#221e42" />
            <polygon points="105,160 182,88 280,160" fill="#1b1c3e" />
            <polygon points="135,160 215,84 280,140 280,160" fill="#141530" />
            {/* Climber on summit with flag */}
            <circle cx="183" cy="80" r="2.8" fill="#141530" />
            <path
              d="M183 83 L183 89 L180 94 M183 89 L186 94 M183 85 L180 88 M183 85 L187 81"
              stroke="#141530"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <line x1="187" y1="88" x2="194" y2="72" stroke="#141530" strokeWidth="1.4" strokeLinecap="round" />
            <polygon points="194,72 205,74 198,79" fill="#141530" />
          </svg>
          <div className={styles.featureCardContent}>
            <strong>
              One profile.
              <br />
              Unlimited
              <br />
              possibilities.
            </strong>
            <small>Built on trust. Powered by AI.</small>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className={styles.progressCard}>
          <strong>Your Progress</strong>
          <div className={styles.ring}>
            <span>75%</span>
          </div>
          <p>
            Great going! Just a<br />
            few more steps.
          </p>
        </div>
      )}

      <div className={`${styles.why} ${step === 5 ? styles.trustCard : ''}`}>
        <h3>
          {step === 5 ? (
            '✓  Your journey is in safe hands.'
          ) : (
            <>Why HireRight{step === 4 ? ' ?' : ''}</>
          )}
        </h3>
        <ul>
          {(step === 5
            ? CONFIRM_ITEMS
            : step === 4
              ? [
                  WHY_ITEMS[0],
                  'Interview with confidence',
                  'Trusted by top companies globally',
                  ...WHY_ITEMS.slice(2),
                ]
              : WHY_ITEMS
          ).map((item) => (
            <li key={item}>
              <span className={styles.check}>✓</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.help}>
        <span>Need help?</span>{' '}
        <Link to="/contact">Talk to us</Link>
      </div>
    </aside>
  )
}
