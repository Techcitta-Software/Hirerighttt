/**
 * Temporary QA flag — remove when scheduled invites are enforced in all environments.
 * Set VITE_ALLOW_IMMEDIATE_INTERVIEW_TEST=true in repo-root .env (dev only).
 */
import type { NavigateFunction } from 'react-router-dom'
import { markImmediateInterview } from './interviewInviteGate'

export function isImmediateInterviewTestEnabled(): boolean {
  return import.meta.env.VITE_ALLOW_IMMEDIATE_INTERVIEW_TEST === 'true'
}

/** Skip scheduled-slot gate and open the live interview studio. */
export function beginImmediateInterviewTest(navigate: NavigateFunction) {
  markImmediateInterview()
  sessionStorage.setItem('hireright.returnToWizard', '1')
  navigate('/interview', { replace: false })
}
