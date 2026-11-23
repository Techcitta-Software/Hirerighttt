import { Link } from 'react-router-dom'
import { STEPS, type WizardStep } from '../data/wizard'
import { BrandLogo } from './BrandLogo'
import { Stepper } from './Stepper'
import styles from './Sidebar.module.css'
import { interviewDurationMinutes } from '../lib/interviewDuration'
import { resolveInterviewJobContext } from '../lib/pendingJobApply'

const WHY_ITEMS = [
  'AI-powered matching with the right roles',
  'Verified by top employers globally',
  '100% secure and privacy-first',
  'Helping talent grow, one connection at a time',
]
const CONFIRM_ITEMS = [
  'AI-powered matching',
  'Fair and unbiased',
  'Trusted by top companies',
  '100% secure and private',
]

/** One encouraging line per step: why it matters. */
const STEP_HINTS: Record<WizardStep, string> = {
  1: 'Your resume fills in the details, so you only review and confirm.',
  2: 'A {minutes}-minute conversation shows employers what you can really do.',
  3: 'Your profile and score unlock roles that fit you.',
}

const STEP_NAMES: Record<WizardStep, string> = {
  1: 'Your profile',
  2: 'AI interview',
  3: 'All set',
}

interface SidebarProps {
  step?: WizardStep
  completedThrough?: number
  onStepClick?: (step: WizardStep) => void
}

export function Sidebar({ step = 1, completedThrough = 0, onStepClick }: SidebarProps) {
  // Same length as the step-2 panel: 20 minutes for a job-link (JD) interview, 15 for the career interview.
  const minutes = interviewDurationMinutes(resolveInterviewJobContext())
  const hints = { ...STEP_HINTS, 2: STEP_HINTS[2].replace('{minutes}', String(minutes)) }
  const total = STEPS.length
  const progress = Math.round((step / total) * 100)
  const whyItems =
    step === 3
      ? CONFIRM_ITEMS
      : step === 2
        ? [WHY_ITEMS[0], 'Interview with confidence', 'Trusted by top companies globally', ...WHY_ITEMS.slice(2)]
        : WHY_ITEMS

  return (
    <aside className={styles.sidebar} aria-label="Onboarding progress">
      <div className={styles.glow} aria-hidden="true" />

      <div className={styles.brand}>
        <BrandLogo size="lg" dark />
      </div>

      <div className={styles.hero}>
        <p className={styles.heroTitle}>
          {step === 3
            ? 'You’re on the right path'
            : step === 2
              ? 'You’ve taken the right step'
              : 'Your journey to the right opportunity starts here'}
        </p>
        <p className={styles.heroText}>
          {step === 3
            ? 'We’re excited to have you with us. Your AI interview helps you showcase your skills and connect with the best opportunities.'
            : step === 2
              ? 'We’re excited to learn more about you and help you connect with the right opportunities.'
              : 'We’re here to understand you better, so we can connect you with opportunities that truly fit your potential.'}
        </p>
      </div>

      <div className={styles.progress}>
        <div className={styles.progressHead}>
          <span className={styles.progressLabel}>
            Step {step} of {total}
          </span>
          <span className={styles.progressCurrent}>{STEP_NAMES[step]}</span>
        </div>
        <div
          className={styles.progressTrack}
          role="progressbar"
          aria-label="Onboarding progress"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={step}
          aria-valuetext={`Step ${step} of ${total}`}
        >
          <span className={styles.progressFill} style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className={styles.steps}>
        <Stepper
          current={step}
          completedThrough={completedThrough}
          onStepClick={(next) => onStepClick?.(next)}
          hints={hints}
        />
      </div>

      <p className={styles.compactHint}>{hints[step]}</p>

      <div className={styles.why}>
        <p className={styles.whyTitle}>
          {step === 3 ? 'Your journey is in safe hands' : 'Why HireRighttt'}
        </p>
        <ul>
          {whyItems.map((item) => (
            <li key={item}>
              <span className={styles.check} aria-hidden="true">
                <svg viewBox="0 0 16 16" fill="none">
                  <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className={styles.help}>
        Need help? <Link to="/contact">Talk to us</Link>
      </p>
    </aside>
  )
}
