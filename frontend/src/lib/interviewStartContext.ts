import type { InterviewStartOptions } from './interviewAgentClient'
import type { InterviewConsent } from './interviewConsent'
import { readInviteInterviewContext } from './interviewInviteGate'
import { ensureJobLinkApplication } from './pendingJobApply'
import type { TargetJob } from './targetJob'
import { getProfile, getUser, resolveCandidateName, type SavedProfile } from './store'

export type InterviewSessionStartContext = {
  mergedProfile: SavedProfile | null
  targetJob: TargetJob | null
  options: InterviewStartOptions
}

export function interviewSessionFingerprint(parts: {
  role: string
  level: string
  jobId?: string
  applicationId?: string
  inviteToken?: string
  jdHash?: string
  consentVersion?: string
}): string {
  return [
    parts.role,
    parts.level,
    parts.jobId || '',
    parts.applicationId || '',
    parts.inviteToken || '',
    parts.jdHash || '',
    parts.consentVersion || '',
  ].join('|')
}

/** Stable short fingerprint for JD text (length + prefix) — not cryptographic. */
export function jdFingerprint(jd: string): string {
  const t = jd.trim()
  if (!t) return '0'
  return `${t.length}:${t.slice(0, 48)}`
}

/**
 * Resolves profile, job link application, and /api/interview/start body fields shared by lobby prefetch and join.
 */
export async function resolveInterviewSessionStartContext(input: {
  role: string
  level: string
  profile: SavedProfile | null
  customJd: string
  targetJobRaw: TargetJob | null
  roleTrackExplicit: boolean
  interviewConsent: InterviewConsent | null
}): Promise<InterviewSessionStartContext> {
  const freshProfile = getProfile()
  const inviteCtx = readInviteInterviewContext()
  const baseProfile = freshProfile ?? input.profile
  const mergedProfile =
    baseProfile && inviteCtx?.resumeText?.trim()
      ? { ...baseProfile, resumeText: inviteCtx.resumeText }
      : baseProfile

  const targetJob = (await ensureJobLinkApplication()) ?? input.targetJobRaw
  const effectiveJd =
    inviteCtx?.jobDescription?.trim() ||
    input.customJd.trim() ||
    targetJob?.jd?.trim() ||
    ''
  const explicitTrack =
    input.roleTrackExplicit || Boolean(targetJob) || effectiveJd.length >= 40

  const options: InterviewStartOptions = {
    jobDescription: effectiveJd,
    explicitRoleTrack: explicitTrack,
    jobId: targetJob?.jobId,
    applicationId: targetJob?.applicationId,
    organizationId: targetJob?.organizationId,
    questionMode:
      targetJob?.applicationId || targetJob?.jobId
        ? undefined
        : targetJob || effectiveJd.length >= 40
          ? 'individual_jd'
          : undefined,
    primarySkills: targetJob?.primarySkills,
    atsScore: targetJob?.atsScore,
    jdMatchScore: targetJob?.jdMatchScore,
    consent: input.interviewConsent ?? undefined,
  }

  return { mergedProfile, targetJob, options }
}

export function displayNameFromSessionProfile(
  mergedProfile: SavedProfile | null,
  fallback: string,
): string {
  if (!mergedProfile) return fallback
  return resolveCandidateName(mergedProfile, getUser()) || fallback
}