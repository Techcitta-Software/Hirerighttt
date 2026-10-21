import type { SavedProfile } from './store'

/** Candidate profile wizard steps (ProfileWizard / Stepper). */
export const ONBOARDING_STEP_COUNT = 5

export function isOnboardingComplete(
  profile?: Pick<SavedProfile, 'completedSteps'> | null,
): boolean {
  return (profile?.completedSteps ?? 0) >= ONBOARDING_STEP_COUNT
}

/** First incomplete step (1–5), or 5 if already complete. */
export function onboardingResumeStep(profile?: Pick<SavedProfile, 'completedSteps'> | null): number {
  const done = profile?.completedSteps ?? 0
  if (done >= ONBOARDING_STEP_COUNT) return ONBOARDING_STEP_COUNT
  return Math.min(ONBOARDING_STEP_COUNT, Math.max(1, done + 1))
}
