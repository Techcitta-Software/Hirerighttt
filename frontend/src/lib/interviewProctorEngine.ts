/**
 * Debounced interview proctoring sections (head pose, eye gaze, multi-face).
 * Runs alongside live FaceTracker UI feedback during the interview room.
 */

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

export type FlagType = 'LOOKING_SIDE' | 'MULTI_FACE' | 'NO_FACE'

export interface InterviewFlagSection {
  id: string
  type: FlagType
  severity: 'medium' | 'high'
  turnIndex: number
  questionText: string
  startSec: number
  endSec: number
  durationSec: number
  reason: string
  peakMetrics: {
    yawDeg?: number
    pitchDeg?: number
    eyeGazeScore?: number
    faceCount?: number
  }
  snapshotDataUrl?: string
  snapshotS3Key?: string
}

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
  snapshotDataUrl?: string
}

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

const SAMPLE_INTERVAL_MS = 250
const YAW_THRESHOLD_DEG = 25
const PITCH_THRESHOLD_DEG = 22
const EYE_GAZE_THRESHOLD = 0.58
const MIN_DURATION_MS: Record<FlagType, number> = {
  LOOKING_SIDE: 2000,
  MULTI_FACE: 1000,
  NO_FACE: 2500,
}
const MERGE_COOLDOWN_MS = 1500
const MAX_SNAPSHOTS_PER_SESSION = 12
const SECONDARY_FACE_MIN_RATIO = 0.15

export class InterviewProctorEngine {
  private landmarker: FaceLandmarker | null = null
  private timerId: number | null = null
  /** Wall-clock ms (Date.now()) aligned with interview recording timeline. */
  private recordingStartWallMs = 0
  private landmarkerTs = -1
  private currentTurnIndex = 1
  private currentQuestionText = ''
  private activeIncidents: Partial<Record<FlagType, ActiveIncident>> = {}
  private completedFlags: InterviewFlagSection[] = []
  private snapshotCount = 0
  private offscreenCanvas: HTMLCanvasElement

  constructor(private onFlagCreated?: (flag: InterviewFlagSection) => void) {
    this.offscreenCanvas = document.createElement('canvas')
    this.offscreenCanvas.width = 320
    this.offscreenCanvas.height = 180
  }

  async init() {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL)
    const attempts: Array<'GPU' | 'CPU'> = ['GPU', 'CPU']
    let lastErr: unknown
    for (const delegate of attempts) {
      try {
        this.landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: 'VIDEO',
          numFaces: 3,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        })
        return
      } catch (err) {
        lastErr = err
      }
    }
    console.warn('[proctor] FaceLandmarker init failed', lastErr)
    this.landmarker = null
  }

  setTurnContext(turnIndex: number, questionText: string) {
    this.currentTurnIndex = turnIndex
    this.currentQuestionText = questionText
  }

  start(videoEl: HTMLVideoElement, recordingStartWallMs = Date.now()) {
    this.recordingStartWallMs = recordingStartWallMs
    if (this.timerId) window.clearInterval(this.timerId)
    this.timerId = window.setInterval(() => {
      this.processFrame(videoEl)
    }, SAMPLE_INTERVAL_MS)
  }

  stop(): InterviewFlagSection[] {
    if (this.timerId) window.clearInterval(this.timerId)
    this.timerId = null
    const now = Date.now()
    ;(['MULTI_FACE', 'LOOKING_SIDE', 'NO_FACE'] as FlagType[]).forEach((type) =>
      this.finalizeIncidentIfQualified(type, now, true),
    )
    return this.completedFlags
  }

  getFlags(): InterviewFlagSection[] {
    return this.completedFlags
  }

  private processFrame(videoEl: HTMLVideoElement) {
    if (!this.landmarker || videoEl.readyState < 2) return
    let mpTs = Math.floor(performance.now())
    if (mpTs <= this.landmarkerTs) mpTs = this.landmarkerTs + 1
    this.landmarkerTs = mpTs
    const res = this.landmarker.detectForVideo(videoEl, mpTs)
    const nowMs = Date.now()

    const landmarks = res.faceLandmarks || []
    const validFaces = landmarks.filter((lm, idx, all) => {
      if (idx === 0) return true
      const primary = all[0]
      if (!primary?.length) return false
      return this.getFaceBoxArea(lm) >= this.getFaceBoxArea(primary) * SECONDARY_FACE_MIN_RATIO
    })

    const faceCount = validFaces.length

    if (faceCount === 0) {
      this.touchIncident('NO_FACE', nowMs, videoEl, { faceCount: 0, direction: 'left frame' })
      this.finalizeIncidentIfQualified('MULTI_FACE', nowMs)
      this.finalizeIncidentIfQualified('LOOKING_SIDE', nowMs)
      return
    }
    this.finalizeIncidentIfQualified('NO_FACE', nowMs)

    if (faceCount > 1) {
      this.touchIncident('MULTI_FACE', nowMs, videoEl, {
        faceCount,
        direction: `${faceCount} people in frame`,
      })
    } else {
      this.finalizeIncidentIfQualified('MULTI_FACE', nowMs)
    }

    const matrix = res.facialTransformationMatrixes?.[0]?.data
    const { yawDeg, pitchDeg } = this.extractHeadAngles(matrix)
    const { gazeScore, gazeDirection } = this.extractEyeGaze(res.faceBlendshapes?.[0]?.categories)

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

      this.touchIncident('LOOKING_SIDE', nowMs, videoEl, {
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
    videoEl: HTMLVideoElement,
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

    const elapsedMs = nowMs - existing.firstSeenMs
    if (
      !existing.snapshotDataUrl &&
      elapsedMs >= MIN_DURATION_MS[type] &&
      this.snapshotCount < MAX_SNAPSHOTS_PER_SESSION
    ) {
      existing.snapshotDataUrl = this.captureLowResFrame(videoEl)
      this.snapshotCount++
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
                ? `${inc.peakYawDeg}° head angle`
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
      snapshotDataUrl: inc.snapshotDataUrl,
    }

    this.completedFlags.push(flag)
    this.onFlagCreated?.(flag)
  }

  private extractHeadAngles(matrixData?: Float32Array | number[]) {
    if (!matrixData || matrixData.length < 16) return { yawDeg: 0, pitchDeg: 0 }
    const m02 = matrixData[8]
    const m12 = matrixData[9]
    const m22 = matrixData[10]
    const yawDeg = Math.atan2(m02, m22) * (180 / Math.PI)
    const pitchDeg = Math.asin(-Math.max(-1, Math.min(1, m12))) * (180 / Math.PI)
    return { yawDeg, pitchDeg }
  }

  private extractEyeGaze(categories?: Array<{ categoryName: string; score: number }>) {
    if (!categories) return { gazeScore: 0, gazeDirection: 'center' as const }
    const get = (name: string) => categories.find((c) => c.categoryName === name)?.score || 0
    const lookLeft = (get('eyeLookOutLeft') + get('eyeLookInRight')) / 2
    const lookRight = (get('eyeLookOutRight') + get('eyeLookInLeft')) / 2
    return lookLeft > lookRight
      ? { gazeScore: lookLeft, gazeDirection: 'left' as const }
      : { gazeScore: lookRight, gazeDirection: 'right' as const }
  }

  private getFaceBoxArea(landmarks: Array<{ x: number; y: number }>) {
    let minX = 1
    let maxX = 0
    let minY = 1
    let maxY = 0
    for (const pt of landmarks) {
      if (pt.x < minX) minX = pt.x
      if (pt.x > maxX) maxX = pt.x
      if (pt.y < minY) minY = pt.y
      if (pt.y > maxY) maxY = pt.y
    }
    return Math.max(0, maxX - minX) * Math.max(0, maxY - minY)
  }

  private captureLowResFrame(videoEl: HTMLVideoElement): string {
    const ctx = this.offscreenCanvas.getContext('2d')
    if (!ctx) return ''
    ctx.drawImage(videoEl, 0, 0, 320, 180)
    return this.offscreenCanvas.toDataURL('image/jpeg', 0.6)
  }
}
