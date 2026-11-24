/**
 * Debounced interview proctoring sections (head pose, eye gaze, no face, multi-face) for the employer review.
 *
 * It has no model of its own: the interview page feeds it each FaceTracker observation (same model, same frame) through
 * observe(). Detection uses the same calibrated, debounced {@link GazeDetector} rules as the review-event log, so the
 * flagged sections and the red marks on the recording timeline always agree.
 */

import type { FaceObservation } from './faceTracker'
import { GazeDetector, type GazeInterval } from './gazeDetector'
import type { InterviewFlagSection } from './store'

export type { InterviewFlagSection } from './store'

export type FlagType = InterviewFlagSection['type']

const FLAG_TYPE: Partial<Record<GazeInterval['type'], FlagType>> = {
  looking_away: 'LOOKING_SIDE',
  no_face: 'NO_FACE',
  multi_face: 'MULTI_FACE',
}

type Context = { turnIndex: number; questionText: string; peakYawDeg: number; peakPitchDeg: number; peakGaze: number; peakFaces: number }

export class InterviewProctorEngine {
  private running = false
  /** Wall-clock ms (Date.now()) aligned with the interview recording timeline. */
  private recordingStartWallMs = 0
  private currentTurnIndex = 1
  private currentQuestionText = ''
  private detector = this.newDetector()
  private contexts = new Map<string, Context>()
  private completedFlags: InterviewFlagSection[] = []
  private onFlagCreated?: (flag: InterviewFlagSection) => void
  private lastObservation: FaceObservation | null = null

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
    this.detector = this.newDetector()
    this.contexts.clear()
    this.completedFlags = []
    this.running = true
  }

  get isRunning(): boolean {
    return this.running
  }

  stop(): InterviewFlagSection[] {
    if (this.running) this.detector.finish(Date.now() - this.recordingStartWallMs)
    this.running = false
    return this.completedFlags
  }

  getFlags(): InterviewFlagSection[] {
    return this.completedFlags
  }

  /** Feed one analysed frame. Frames that could not be analysed (null) are skipped. */
  observe(obs: FaceObservation | null, nowMs = Date.now()) {
    if (!this.running || !obs) return
    this.lastObservation = obs
    this.detector.update(obs, nowMs - this.recordingStartWallMs)
  }

  private newDetector() {
    return new GazeDetector((interval, phase) => this.onInterval(interval, phase))
  }

  private onInterval(interval: GazeInterval, phase: 'start' | 'update' | 'end') {
    const type = FLAG_TYPE[interval.type]
    if (!type) return
    let ctx = this.contexts.get(interval.key)
    if (!ctx) {
      ctx = {
        turnIndex: this.currentTurnIndex,
        questionText: this.currentQuestionText,
        peakYawDeg: 0,
        peakPitchDeg: 0,
        peakGaze: 0,
        peakFaces: type === 'NO_FACE' ? 0 : 1,
      }
      this.contexts.set(interval.key, ctx)
    }
    const o = this.lastObservation
    if (o && phase !== 'end') {
      ctx.peakYawDeg = Math.max(ctx.peakYawDeg, Math.round(Math.abs(o.yawDeg)))
      ctx.peakPitchDeg = Math.max(ctx.peakPitchDeg, Math.round(Math.abs(o.pitchDeg)))
      ctx.peakGaze = Math.max(ctx.peakGaze, Number((o.gazeScore || 0).toFixed(2)))
      ctx.peakFaces = Math.max(ctx.peakFaces, o.faceCount)
    }
    if (phase !== 'end') return

    const startSec = Number((interval.startMs / 1000).toFixed(1))
    const endSec = Math.max(startSec + 0.1, Number((interval.endMs / 1000).toFixed(1)))
    const durationSec = Number((endSec - startSec).toFixed(1))
    const reason =
      type === 'MULTI_FACE'
        ? `${Math.max(2, ctx.peakFaces)} people detected in camera frame for ${durationSec}s`
        : type === 'LOOKING_SIDE'
          ? `${interval.reason || 'Looked away'} for ${durationSec}s`
          : `No face visible in camera frame for ${durationSec}s`

    const flag: InterviewFlagSection = {
      id: `flag_${ctx.turnIndex}_${Math.round(startSec * 10)}`,
      type,
      severity: interval.severity,
      turnIndex: ctx.turnIndex,
      questionText: ctx.questionText,
      startSec,
      endSec,
      durationSec,
      reason,
      peakMetrics: {
        yawDeg: ctx.peakYawDeg,
        pitchDeg: ctx.peakPitchDeg,
        eyeGazeScore: ctx.peakGaze,
        faceCount: ctx.peakFaces,
      },
    }
    this.contexts.delete(interval.key)
    this.completedFlags.push(flag)
    this.onFlagCreated?.(flag)
  }
}
