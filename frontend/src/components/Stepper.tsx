import { STEPS, type WizardStep } from '../data/wizard'
import styles from './Stepper.module.css'

interface Props {
  current: WizardStep
  onStepClick: (step: WizardStep) => void
  completedThrough: number
  /** Optional one-line "why this step matters" copy, keyed by step id. */
  hints?: Partial<Record<WizardStep, string>>
}

/** Sentence-case display labels for the wizard steps. */
const STEP_LABELS: Partial<Record<WizardStep, string>> = {
  1: 'Your profile',
  2: 'AI interview',
  3: 'All set',
}

export function Stepper({ current, onStepClick, completedThrough, hints }: Props) {
  // Active stage index in 0..STEPS.length - 1
  const activeIndex = Math.max(0, Math.min(STEPS.length - 1, current - 1))

  return (
    <nav className={styles.stepper} aria-label="Profile setup progress">
      <ol className={styles.list}>
        {STEPS.map((step, index) => {
          const isActive = index === activeIndex
          // A step is done ONLY if it comes strictly before the currently active stage
          const isDone = index < activeIndex
          // Step is clickable if it is current or previous, or already reached
          const isClickable = index <= Math.max(activeIndex, completedThrough)
          const hint = hints?.[step.id]

          return (
            <li
              key={`${index}-${step.label}`}
              className={`${styles.item} ${isActive ? styles.active : ''} ${isDone ? styles.done : ''}`}
            >
              <button
                type="button"
                className={styles.step}
                onClick={() => onStepClick(step.id)}
                disabled={!isClickable}
                aria-current={isActive ? 'step' : undefined}
              >
                <span className={styles.marker} aria-hidden={isDone ? undefined : true}>
                  {isDone ? (
                    <>
                      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className={styles.srOnly}>Done: </span>
                    </>
                  ) : (
                    index + 1
                  )}
                </span>
                <span className={styles.copy}>
                  <span className={styles.label}>
                    <span className={styles.srOnly}>Step {index + 1}: </span>
                    {STEP_LABELS[step.id] ?? step.label}
                  </span>
                  {hint ? <span className={styles.hint}>{hint}</span> : null}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
