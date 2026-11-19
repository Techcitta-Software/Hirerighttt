/**
 * Debounced interview proctoring sections (head pose, eye gaze, multi-face).
 *
 * It has no model of its own: the interview page feeds it each FaceTracker observation (same model, same frame,
 * ~3 Hz) through observe(), so the room only ever runs one face model.
 */

import type { FaceObservation } from './faceTracker'
import type { InterviewFlagSection } from './store'

export type { InterviewFlagSection } from './store'

export type FlagType = InterviewFlagSection['type']

interface ActiveIncident {
  type: FlagType
  firstSeenMs: number
  lastSeenMs: number
  turnIndex: number
  questionText: string
  peakYawDeg: number
  peakPitchDeg: number
  peakGazeScore: number
  peakFaceCount: number
  directionLabel: string
}

const YAW_THRESHOLD_DEG = 25
const PITCH_THRESHOLD_DEG = 22
const EYE_GAZE_THRESHOLD = 0.58
const MIN_DURATION_MS: Record<FlagType, number> = {
  LOOKING_SIDE: 2000,
  MULTI_FACE: 1000,
  NO_FACE: 2500,
}
const MERGE_COOLDOWN_MS = 1500

export class InterviewProctorEngine {
  private running = false
  /** Wall-clock ms (Date.now()) aligned with interview recording timeline. */
  private recordingStartWallMs = 0
  private currentTurnIndex = 1
  private currentQuestionText = ''
  private activeIncidents: Partial<Record<FlagType, ActiveIncident>> = {}
  private completedFlags: InterviewFlagSection[] = []
  private onFlagCreated?: (flag: InterviewFlagSection) => void

  constructor(onFlagCreated?: (flag: InterviewFlagSection) => void) {
    this.onFlagCreated = onFlagCreated
  }

  setTurnContext(turnIndex: number, questionText: string) {
    this.currentTurnIndex = turnIndex
    this.currentQuestionText = questionText
  }

  /** Starts accepting observations; `recordingStartWallMs` is the recording timeline origin. */
  start(recordingStartWallMs = Date.now()) {
    this.recordingStartWallMs = recordingStartWallMs
    this.running = true
  }

  get isRunning(): boolean {
    return this.running
  }

  stop(): InterviewFlagSection[] {
    this.running = false
    const now = Date.now()
    ;(['MULTI_FACE', 'LOOKING_SIDE', 'NO_FACE'] as FlagType[]).forEach((type) =>
      this.finalizeIncidentIfQualified(type, now, true),
    )
    return this.completedFlags
  }

  getFlags(): InterviewFlagSection[] {
    return this.completedFlags
  }

  /** Feed one analysed frame. Frames that could not be analysed (null) are skipped. */
  observe(obs: FaceObservation | null, nowMs = Date.now()) {
    if (!this.running || !obs) return
    const { faceCount, yawDeg, pitchDeg, gazeScore, gazeDirection } = obs

    if (faceCount === 0) {
      this.touchIncident('NO_FACE', nowMs, { faceCount: 0, direction: 'left frame' })
      this.finalizeIncidentIfQualified('MULTI_FACE', nowMs)
      this.finalizeIncidentIfQualified('LOOKING_SIDE', nowMs)
      return
    }
    this.finalizeIncidentIfQualified('NO_FACE', nowMs)

    if (faceCount > 1) {
      this.touchIncident('MULTI_FACE', nowMs, {
        faceCount,
        direction: `${faceCount} people in frame`,
      })
    } else {
      this.finalizeIncidentIfQualified('MULTI_FACE', nowMs)
    }

    const isHeadTurned =
      Math.abs(yawDeg) >= YAW_THRESHOLD_DEG || pitchDeg >= PITCH_THRESHOLD_DEG
    const isEyeShifted = gazeScore >= EYE_GAZE_THRESHOLD

    if (isHeadTurned || isEyeShifted) {
      const direction =
        Math.abs(yawDeg) >= YAW_THRESHOLD_DEG
          ? yawDeg > 0
            ? 'left'
            : 'right'
          : pitchDeg >= PITCH_THRESHOLD_DEG
            ? 'down'
            : `sideways (${gazeDirection} eye gaze)`

      this.touchIncident('LOOKING_SIDE', nowMs, {
        yawDeg: Math.round(Math.abs(yawDeg)),
        pitchDeg: Math.round(pitchDeg),
        gazeScore: Number(gazeScore.toFixed(2)),
        faceCount: 1,
        direction,
      })
    } else {
      this.finalizeIncidentIfQualified('LOOKING_SIDE', nowMs)
    }
  }

  private touchIncident(
    type: FlagType,
    nowMs: number,
    metrics: {
      yawDeg?: number
      pitchDeg?: number
      gazeScore?: number
      faceCount?: number
      direction: string
    },
  ) {
    const existing = this.activeIncidents[type]
    if (!existing) {
      this.activeIncidents[type] = {
        type,
        firstSeenMs: nowMs,
        lastSeenMs: nowMs,
        turnIndex: this.currentTurnIndex,
        questionText: this.currentQuestionText,
        peakYawDeg: metrics.yawDeg || 0,
        peakPitchDeg: metrics.pitchDeg || 0,
        peakGazeScore: metrics.gazeScore || 0,
        peakFaceCount: metrics.faceCount || 1,
        directionLabel: metrics.direction,
      }
      return
    }

    existing.lastSeenMs = nowMs
    if ((metrics.yawDeg || 0) > existing.peakYawDeg) {
      existing.peakYawDeg = metrics.yawDeg!
      existing.directionLabel = metrics.direction
    }
    if ((metrics.gazeScore || 0) > existing.peakGazeScore) {
      existing.peakGazeScore = metrics.gazeScore!
    }
    if ((metrics.faceCount || 0) > existing.peakFaceCount) {
      existing.peakFaceCount = metrics.faceCount!
    }
  }

  private finalizeIncidentIfQualified(type: FlagType, nowMs: number, forceFlush = false) {
    const inc = this.activeIncidents[type]
    if (!inc) return

    if (!forceFlush && nowMs - inc.lastSeenMs < MERGE_COOLDOWN_MS) return

    const durationMs = inc.lastSeenMs - inc.firstSeenMs
    delete this.activeIncidents[type]

    if (durationMs < MIN_DURATION_MS[type]) return

    const startSec = Math.max(
      0,
      Number(((inc.firstSeenMs - this.recordingStartWallMs) / 1000).toFixed(1)),
    )
    const endSec = Math.max(
      startSec + 1,
      Number(((inc.lastSeenMs - this.recordingStartWallMs) / 1000).toFixed(1)),
    )
    const durationSec = Number((endSec - startSec).toFixed(1))

    const severity: 'medium' | 'high' =
      type === 'MULTI_FACE' || durationSec >= 5 ? 'high' : 'medium'

    const reason =
      type === 'MULTI_FACE'
        ? `${inc.peakFaceCount} people detected in camera frame for ${durationSec}s`
        : type === 'LOOKING_SIDE'
          ? `Candidate looked ${inc.directionLabel} (${
              inc.peakYawDeg >= YAW_THRESHOLD_DEG
                ? `${inc.peakYawDeg}Â° head angle`
                : 'sustained eye shift'
            }) for ${durationSec}s`
          : `No face visible in camera frame for ${durationSec}s`

    const flag: InterviewFlagSection = {
      id: `flag_${inc.turnIndex}_${Math.round(startSec * 10)}`,
      type,
      severity,
      turnIndex: inc.turnIndex,
      questionText: inc.questionText,
      startSec,
      endSec,
      durationSec,
      reason,
      peakMetrics: {
        yawDeg: inc.peakYawDeg,
        pitchDeg: inc.peakPitchDeg,
        eyeGazeScore: inc.peakGazeScore,
        faceCount: inc.peakFaceCount,
      },
    }

    this.completedFlags.push(flag)
    this.onFlagCreated?.(flag)
  }

}
