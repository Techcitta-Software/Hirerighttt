import type { SavedProfile } from './store'
import type { WizardStep } from '../data/wizard'

/** Persisted profile progress still uses legacy 1–5; UI shows 3 steps. */
export const ONBOARDING_STEP_COUNT = 5

const UI_STEP_LEGACY_COMPLETE: Record<WizardStep, number> = {
  1: 3,
  2: 4,
  3: 5,
}

export function isOnboardingComplete(
  profile?: Pick<SavedProfile, 'completedSteps'> | null,
): boolean {
  return (profile?.completedSteps ?? 0) >= ONBOARDING_STEP_COUNT
}

/** UI stepper “completed through” index (0–3) from stored progress. */
export function uiCompletedThrough(completedSteps: number | undefined): number {
  const done = completedSteps ?? 0
  if (done >= 5) return 3
  if (done >= 4) return 2
  if (done >= 3) return 1
  return 0
}

/** First incomplete UI step (1–3). */
export function onboardingResumeStep(
  profile?: Pick<SavedProfile, 'completedSteps'> | null,
): WizardStep {
  const done = profile?.completedSteps ?? 0
  if (done >= ONBOARDING_STEP_COUNT) return 3
  if (done >= 4) return 3
  if (done >= 3) return 2
  return 1
}

/** Legacy completedSteps to set when the user finishes a UI step. */
export function legacyCompletedAfterUiStep(step: WizardStep): number {
  return UI_STEP_LEGACY_COMPLETE[step]
}

/** Parse ?step= from URL (supports legacy 4–5). */
export function parseOnboardingStepParam(raw: number): WizardStep {
  if (raw === 4) return 2
  if (raw === 5) return 3
  if (raw >= 1 && raw <= 3) return raw as WizardStep
  return 1
}
