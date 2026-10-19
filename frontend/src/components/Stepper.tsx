import { Fragment } from 'react'
import { STEPS, type WizardStep } from '../data/wizard'
import styles from './Stepper.module.css'

interface Props {
  current: WizardStep
  onStepClick: (step: WizardStep) => void
  completedThrough: number
}

export function Stepper({ current, onStepClick, completedThrough }: Props) {
  // Active stage index in 0..4
  const activeIndex = Math.max(0, Math.min(STEPS.length - 1, current - 1))

  return (
    <nav className={`${styles.stepper} ${styles.compact}`} aria-label="Profile setup progress">
      <ol className={styles.list}>
        {STEPS.map((step, index) => {
          const isActive = index === activeIndex
          // A step is done ONLY if it comes strictly before the currently active stage
          const isDone = index < activeIndex
          // Step is clickable if it is current or previous, or already reached
          const isClickable = index <= Math.max(activeIndex, completedThrough)

          return (
            <Fragment key={`${index}-${step.label}`}>
              <li className={styles.item}>
                <button
                  type="button"
                  className={`${styles.step} ${isActive ? styles.active : ''} ${isDone ? styles.done : ''}`}
                  onClick={() => onStepClick(step.id)}
                  disabled={!isClickable}
                  aria-current={isActive ? 'step' : undefined}
                >
                  <span className={styles.circle}>
                    {isDone ? '✓' : index + 1}
                  </span>
                  <span className={styles.copy}>
                    <span className={styles.label}>{step.label}</span>
                  </span>
                </button>
              </li>
              {index < STEPS.length - 1 && (
                <li className={styles.connectorItem} aria-hidden="true">
                  <div
                    className={`${styles.connector} ${isDone ? styles.connectorActive : ''}`}
                  />
                </li>
              )}
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}
