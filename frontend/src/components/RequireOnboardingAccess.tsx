import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { resolveAuthenticatedDestination } from '../lib/authSession'
import { getProfile, getUser } from '../lib/store'

/**
 * Onboarding is for new / in-progress candidates only — not returning users who finished the wizard.
 */
export function RequireOnboardingAccess({ children }: { children: ReactNode }) {
  const user = getUser()
  const profile = getProfile()
  const uploadIntent =
    typeof sessionStorage !== 'undefined' &&
    sessionStorage.getItem('hireright.intent') === 'upload_resume'

  const completed = (profile?.completedSteps ?? 0) >= 3

  if (user && completed && !uploadIntent) {
    return <Navigate to={resolveAuthenticatedDestination(user)} replace />
  }

  return <>{children}</>
}
