import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { isOnboardingComplete } from '../lib/onboardingProgress'
import { resolveAuthenticatedDestination } from '../lib/authSession'
import { getProfile, getUser } from '../lib/store'

/**
 * Onboarding wizard is for candidates who have not finished all 5 steps.
 * Completed users go to the dashboard (edit profile at /profile).
 */
export function RequireOnboardingAccess({ children }: { children: ReactNode }) {
  const user = getUser()
  const profile = getProfile()

  if (user && isOnboardingComplete(profile)) {
    return <Navigate to={resolveAuthenticatedDestination(user)} replace />
  }

  return <>{children}</>
}
