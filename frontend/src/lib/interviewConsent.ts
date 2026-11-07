/**
 * Candidate consent for recording, face tracking and AI scoring.
 * Bump CONSENT_VERSION whenever the consent wording changes so stored records stay traceable.
 */
export const INTERVIEW_CONSENT_VERSION = '2026-11-07'

export type InterviewConsent = {
  version: string
  recording: true
  faceTracking: true
  aiScoring: true
  acceptedAt: string
}

export function buildInterviewConsent(): InterviewConsent {
  return {
    version: INTERVIEW_CONSENT_VERSION,
    recording: true,
    faceTracking: true,
    aiScoring: true,
    acceptedAt: new Date().toISOString(),
  }
}
