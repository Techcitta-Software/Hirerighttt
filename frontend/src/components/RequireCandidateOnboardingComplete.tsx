import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { isOnboardingComplete, onboardingResumeStep } from '../lib/onboardingProgress'
import { getProfile, getUser } from '../lib/store'

/** Jobseeker app areas (dashboard, jobs, …) require finished 5-step onboarding first. */
export function RequireCandidateOnboardingComplete({ children }: { children: ReactNode }) {
  const user = getUser()
  const profile = getProfile()
  if (user?.role === 'jobseeker' && !isOnboardingComplete(profile)) {
    return (
      <Navigate
        to={`/onboarding?step=${onboardingResumeStep(profile)}`}
        replace
      />
    )
  }
  return <>{children}</>
}
