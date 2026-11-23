import {
  startInterviewSession,
  type InterviewStartResponse,
} from './interviewAgentClient'
import {
  interviewSessionFingerprint,
  jdFingerprint,
  resolveInterviewSessionStartContext,
  type InterviewSessionStartContext,
} from './interviewStartContext'
import type { InterviewConsent } from './interviewConsent'
import { readStoredInterviewInvite } from './interviewInviteGate'
import type { TargetJob } from './targetJob'
import type { SavedProfile } from './store'

export type LobbySessionPrepPayload = {
  started: InterviewStartResponse
  targetJob: TargetJob | null
  mergedProfile: SavedProfile | null
  context: InterviewSessionStartContext
}

type PrepEntry = {
  key: string
  promise: Promise<LobbySessionPrepPayload>
  startedAt: number
}

let activePrep: PrepEntry | null = null

/** Lobby prefetch is only valid for a short window so an abandoned session is not reused after a long wait. */
export const LOBBY_SESSION_PREP_TTL_MS = 12 * 60 * 1000

export function lobbySessionPrepKey(input: {
  role: string
  level: string
  targetJobRaw: TargetJob | null
  customJd: string
  interviewConsent: InterviewConsent | null
}): string {
  const invite = readStoredInterviewInvite()?.token
  return interviewSessionFingerprint({
    role: input.role,
    level: input.level,
    jobId: input.targetJobRaw?.jobId,
    applicationId: input.targetJobRaw?.applicationId,
    inviteToken: invite,
    jdHash: jdFingerprint(input.customJd || input.targetJobRaw?.jd || ''),
    consentVersion: input.interviewConsent?.version,
  })
}

export function invalidateLobbySessionPrep(): void {
  activePrep = null
}

export function peekLobbySessionPrep(key: string): PrepEntry | null {
  if (!activePrep || activePrep.key !== key) return null
  if (Date.now() - activePrep.startedAt > LOBBY_SESSION_PREP_TTL_MS) {
    activePrep = null
    return null
  }
  return activePrep
}

/**
 * Starts (or returns) a single in-flight interview session + question batch for the waiting room.
 * No UI hooks — callers only await this when the candidate joins.
 */
export function beginLobbySessionPrep(
  key: string,
  run: () => Promise<LobbySessionPrepPayload>,
): Promise<LobbySessionPrepPayload> {
  const existing = peekLobbySessionPrep(key)
  if (existing) return existing.promise

  const promise = run().catch((err) => {
    if (activePrep?.promise === promise) activePrep = null
    throw err
  })
  activePrep = { key, promise, startedAt: Date.now() }
  return promise
}

export async function runLobbySessionPrep(input: {
  role: string
  level: string
  profile: SavedProfile | null
  customJd: string
  targetJobRaw: TargetJob | null
  roleTrackExplicit: boolean
  interviewConsent: InterviewConsent | null
}): Promise<LobbySessionPrepPayload> {
  const context = await resolveInterviewSessionStartContext({
    role: input.role,
    level: input.level,
    profile: input.profile,
    customJd: input.customJd,
    targetJobRaw: input.targetJobRaw,
    roleTrackExplicit: input.roleTrackExplicit,
    interviewConsent: input.interviewConsent,
  })
  const started = await startInterviewSession(
    input.role,
    input.level,
    context.mergedProfile,
    context.options,
  )
  return {
    started,
    targetJob: context.targetJob,
    mergedProfile: context.mergedProfile,
    context,
  }
}