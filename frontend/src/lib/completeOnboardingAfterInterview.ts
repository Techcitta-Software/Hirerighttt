import type { NavigateFunction } from 'react-router-dom'
import { initialFormData, type ProfileFormData } from '../data/wizard'
import { apiHealth, apiSaveProfile } from './api'
import {
  clearImmediateInterviewFlag,
  isImmediateInterviewAllowed,
} from './interviewInviteGate'
import { isOnboardingComplete, onboardingResumeStep, ONBOARDING_STEP_COUNT } from './onboardingProgress'
import { getProfile, saveProfile, type SavedProfile } from './store'

const RETURN_TO_WIZARD_KEY = 'hireright.returnToWizard'

/**
 * Where to send a candidate who exits the interview room before finishing onboarding.
 * /dashboard and /profile are gated — incomplete users must return to the wizard (usually step 5).
 */
export function getCandidateInterviewExitPath(): string {
  const profile = getProfile()
  if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(RETURN_TO_WIZARD_KEY) === '1') {
    return `/onboarding?step=${onboardingResumeStep(profile)}`
  }
  if (!isOnboardingComplete(profile)) {
    return `/onboarding?step=${onboardingResumeStep(profile)}`
  }
  return '/dashboard'
}

export function leaveInterviewRoom(navigate: NavigateFunction): void {
  navigate(getCandidateInterviewExitPath(), { replace: true })
}

export type PostInterviewReportState = {
  fromInterview?: boolean
  /** “Interview immediately” flow — auto-continue to workspace after the report. */
  autoContinueDashboard?: boolean
}

export const PENDING_REPORT_UPLOAD_KEY = 'hireright.pendingReportUpload'

/** Right after scoring — show the full career report once (not the workspace home). */
export function goToInterviewReportAfterCompletion(
  navigate: NavigateFunction,
  options?: { uploadReport?: boolean },
): void {
  sessionStorage.removeItem('hireright.returnToWizard')
  sessionStorage.removeItem('hireright.wizardStep')
  if (options?.uploadReport) {
    sessionStorage.setItem(PENDING_REPORT_UPLOAD_KEY, '1')
  }
  const immediateFlow = isImmediateInterviewAllowed()
  clearImmediateInterviewFlag()
  const state: PostInterviewReportState = {
    fromInterview: true,
    autoContinueDashboard: immediateFlow,
  }
  navigate('/dashboard/report', { replace: true, state })
}

/** From the report — continue to the candidate workspace (SaaS home). */
export function goToCandidateDashboardAfterInterview(navigate: NavigateFunction): void {
  sessionStorage.removeItem('hireright.returnToWizard')
  sessionStorage.removeItem('hireright.wizardStep')
  navigate('/dashboard', { replace: true })
}

/** Step 5 (AI interview done) — unlocks /dashboard and job matches. */
export async function markCandidateOnboardingCompleteAfterInterview(): Promise<SavedProfile | null> {
  const current = getProfile()
  if ((current?.completedSteps ?? 0) >= ONBOARDING_STEP_COUNT) {
    return current
  }
  const merged: ProfileFormData = {
    ...initialFormData,
    ...(current || {}),
    resumeFile: null,
    resumeName: current?.resumeName ?? null,
  }
  const saved = saveProfile(merged, ONBOARDING_STEP_COUNT)
  try {
    if (await apiHealth()) await apiSaveProfile(saved)
  } catch {
    // local profile still marks onboarding complete
  }
  return saved
}
