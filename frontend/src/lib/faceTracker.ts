/**
 * Single-person face tracking for the AI interview (lobby + room).
 *
 * One MediaPipe FaceLandmarker, shared by the live status chip and the proctoring engine, so the room never runs
 * two models. It runs on the CPU delegate (the GPU delegate stalls the main thread on a synchronous readPixels
 * every frame) against a small downscaled frame, and the page samples it at ~3 Hz.
 */

import { FaceLandmarker, FilesetResolver, type FaceLandmarkerResult } from '@mediapipe/tasks-vision'

export type FaceIssue =
  | 'ok'
  | 'no_face'
  | 'multi_person'
  | 'looking_away'
  | 'too_far'
  | 'unable_to_assess'
  | 'engine_off'
  | 'scanning'

export type FaceTrackStatus = {
  faceCount: number
  ok: boolean
  label: string
  severity: 'ok' | 'warn' | 'block' | 'ban'
  issue: FaceIssue
  faceAreaRatio: number
  /** Normalised head turn, -1..1 (about ±60°). */
  yaw: number
  lookingForward: boolean
}

/** Raw per-frame measurements, consumed by the proctoring engine (same model, same frame). */
export type FaceObservation = {
  faceCount: number
  yawDeg: number
  pitchDeg: number
  gazeScore: number
  gazeDirection: 'left' | 'right' | 'center'
}

/** Match installed @mediapipe/tasks-vision version (see package.json). */
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

/** How often callers should sample (≈3 Hz). */
export const FACE_SAMPLE_INTERVAL_MS = 330

/** Frames are downscaled to this width before inference (keeps upload/readback tiny). */
const FRAME_WIDTH = 320

const TOO_FAR_RATIO = 0.035
const VERY_FAR_RATIO = 0.018
const YAW_WARN = 0.32
const YAW_STRONG = 0.48
/** Degrees of head turn that map to yaw = 1. */
const YAW_FULL_SCALE_DEG = 60
/** A second face smaller than this share of the main face is background noise (poster, reflection). */
const SECONDARY_FACE_MIN_RATIO = 0.15

let landmarkerPromise: Promise<FaceLandmarker | null> | null = null

async function getLandmarker(): Promise<FaceLandmarker | null> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_URL)
        // CPU first: at 3 Hz on a 320px frame it is as accurate and never blocks on GPU readback.
        for (const delegate of ['CPU', 'GPU'] as const) {
          try {
            return await FaceLandmarker.createFromOptions(vision, {
              baseOptions: { modelAssetPath: MODEL_URL, delegate },
              runningMode: 'VIDEO',
              numFaces: 3,
              minFaceDetectionConfidence: 0.5,
              minFacePresenceConfidence: 0.5,
              minTrackingConfidence: 0.5,
              outputFaceBlendshapes: true,
              outputFacialTransformationMatrixes: true,
            })
          } catch (err) {
            console.warn(`[face-tracker] init failed (${delegate})`, err)
          }
        }
      } catch (err) {
        console.warn('[face-tracker] runtime failed to load', err)
      }
      return null
    })()
  }
  return landmarkerPromise
}

/** Start loading the model early (e.g. as soon as the camera is on). */
export function preloadFaceTracker(): void {
  void getLandmarker()
}

function boxArea(landmarks: Array<{ x: number; y: number }>): number {
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

export function headAnglesFromMatrix(matrixData?: ArrayLike<number>): { yawDeg: number; pitchDeg: number } {
  if (!matrixData || matrixData.length < 16) return { yawDeg: 0, pitchDeg: 0 }
  const m02 = matrixData[8]
  const m12 = matrixData[9]
  const m22 = matrixData[10]
  const yawDeg = Math.atan2(m02, m22) * (180 / Math.PI)
  const pitchDeg = Math.asin(-Math.max(-1, Math.min(1, m12))) * (180 / Math.PI)
  return { yawDeg, pitchDeg }
}

export function eyeGazeFromBlendshapes(
  categories?: Array<{ categoryName: string; score: number }>,
): { gazeScore: number; gazeDirection: 'left' | 'right' | 'center' } {
  if (!categories) return { gazeScore: 0, gazeDirection: 'center' }
  const get = (name: string) => categories.find((c) => c.categoryName === name)?.score || 0
  const lookLeft = (get('eyeLookOutLeft') + get('eyeLookInRight')) / 2
  const lookRight = (get('eyeLookOutRight') + get('eyeLookInLeft')) / 2
  return lookLeft > lookRight
    ? { gazeScore: lookLeft, gazeDirection: 'left' }
    : { gazeScore: lookRight, gazeDirection: 'right' }
}

/** Faces that count: the largest, plus any other face at least 15% of its size. */
export function countRealFaces(areas: number[]): number {
  if (!areas.length) return 0
  const primary = Math.max(...areas)
  return areas.filter((a) => a >= primary * SECONDARY_FACE_MIN_RATIO).length
}

export function buildStatus(
  faceCount: number,
  opts: {
    yaw?: number
    area?: number
    lookingForward?: boolean
  } = {},
): FaceTrackStatus {
  const yaw = opts.yaw ?? 0
  const area = opts.area ?? 0
  const lookingForward = opts.lookingForward ?? true

  if (faceCount === 0) {
    return {
      faceCount: 0,
      ok: false,
      label: 'We can’t see your face — sit in front of the camera',
      severity: 'warn',
      issue: 'no_face',
      faceAreaRatio: 0,
      yaw: 0,
      lookingForward: false,
    }
  }

  if (faceCount > 1) {
    return {
      faceCount,
      ok: false,
      label: `${faceCount} people in view — only you should be on camera`,
      severity: 'warn',
      issue: 'multi_person',
      faceAreaRatio: area,
      yaw,
      lookingForward: false,
    }
  }

  if (!lookingForward || Math.abs(yaw) >= YAW_STRONG) {
    return {
      faceCount: 1,
      ok: false,
      label: 'Face the camera — brief glances are fine',
      severity: 'warn',
      issue: 'looking_away',
      faceAreaRatio: area,
      yaw,
      lookingForward: false,
    }
  }

  if (Math.abs(yaw) >= YAW_WARN) {
    return {
      faceCount: 1,
      ok: true,
      label: 'Turn a little toward the camera',
      severity: 'warn',
      issue: 'looking_away',
      faceAreaRatio: area,
      yaw,
      lookingForward: false,
    }
  }

  if (area > 0 && area < VERY_FAR_RATIO) {
    return {
      faceCount: 1,
      ok: true,
      label: 'You look far away — move closer to the camera',
      severity: 'warn',
      issue: 'too_far',
      faceAreaRatio: area,
      yaw,
      lookingForward: true,
    }
  }

  if (area > 0 && area < TOO_FAR_RATIO) {
    return {
      faceCount: 1,
      ok: true,
      label: 'Move a little closer to the camera',
      severity: 'warn',
      issue: 'too_far',
      faceAreaRatio: area,
      yaw,
      lookingForward: true,
    }
  }

  return {
    faceCount: 1,
    ok: true,
    label: 'You’re in view',
    severity: 'ok',
    issue: 'ok',
    faceAreaRatio: area,
    yaw,
    lookingForward: true,
  }
}

export function statusFromCount(faceCount: number): FaceTrackStatus {
  return buildStatus(faceCount)
}

const SCANNING: FaceTrackStatus = {
  faceCount: 0,
  ok: false,
  label: 'Looking for your face…',
  severity: 'warn',
  issue: 'scanning',
  faceAreaRatio: 0,
  yaw: 0,
  lookingForward: false,
}

function unable(label: string): FaceTrackStatus {
  return { ...SCANNING, issue: 'unable_to_assess', label }
}

/**
 * Identity of what the candidate actually sees. Two statuses with the same key render identically, so callers
 * only need to update React state when the key changes.
 */
export function faceStatusKey(status: FaceTrackStatus): string {
  return [
    status.issue,
    status.severity,
    status.faceCount,
    status.label,
    status.ok ? 1 : 0,
    status.lookingForward ? 1 : 0,
    Math.abs(status.yaw) >= YAW_STRONG ? 1 : 0,
  ].join('|')
}

/** Mean luminance and variance of an RGBA buffer, sampling every `step`-th pixel. */
export function frameLighting(data: Uint8ClampedArray, step = 4): { mean: number; variance: number } {
  let sum = 0
  let squares = 0
  let n = 0
  for (let i = 0; i < data.length; i += 4 * step) {
    const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
    sum += l
    squares += l * l
    n += 1
  }
  if (!n) return { mean: 0, variance: 0 }
  const mean = sum / n
  return { mean, variance: squares / n - mean * mean }
}

export class FaceTracker {
  private lastTs = -1
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private videoTime = -1
  private frameAt = performance.now()
  private disposed = false
  /** Measurements from the last analysed frame (null when no frame could be analysed). */
  lastObservation: FaceObservation | null = null
  multiPersonStreak = 0
  noFaceStreak = 0

  async ready() {
    return (await getLandmarker()) != null
  }

  private frame(video: HTMLVideoElement): HTMLCanvasElement | null {
    if (!this.canvas) {
      this.canvas = document.createElement('canvas')
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })
    }
    const ctx = this.ctx
    if (!ctx) return null
    const w = FRAME_WIDTH
    const h = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * FRAME_WIDTH))
    if (this.canvas.width !== w) this.canvas.width = w
    if (this.canvas.height !== h) this.canvas.height = h
    ctx.drawImage(video, 0, 0, w, h)
    return this.canvas
  }

  async detect(video: HTMLVideoElement | null): Promise<FaceTrackStatus> {
    this.lastObservation = null
    if (this.disposed || !video || video.readyState < 2 || !video.videoWidth) {
      return unable('Waiting for your camera…')
    }
    if (video.currentTime !== this.videoTime) {
      this.videoTime = video.currentTime
      this.frameAt = performance.now()
    }
    if (document.hidden || performance.now() - this.frameAt > 1500) {
      return unable('Camera paused — keep this tab open')
    }

    const landmarker = await getLandmarker()
    if (this.disposed) return SCANNING
    if (!landmarker) {
      return {
        faceCount: 0,
        ok: false,
        label: 'Camera check isn’t available — refresh to try again',
        severity: 'warn',
        issue: 'engine_off',
        faceAreaRatio: 0,
        yaw: 0,
        lookingForward: true,
      }
    }

    const canvas = this.frame(video)
    if (!canvas || !this.ctx) return unable('Waiting for your camera…')
    const { mean, variance } = frameLighting(this.ctx.getImageData(0, 0, canvas.width, canvas.height).data)
    if (mean < 35 || mean > 235 || variance < 70) {
      return unable('We can’t see you clearly — add light and keep the lens clear')
    }

    // MediaPipe VIDEO mode requires strictly increasing timestamps (ms).
    let ts = Math.floor(performance.now())
    if (ts <= this.lastTs) ts = this.lastTs + 1
    this.lastTs = ts

    let result: FaceLandmarkerResult
    try {
      result = landmarker.detectForVideo(canvas, ts)
    } catch (err) {
      console.warn('[face-tracker] detect error', err)
      return unable('Camera check interrupted — hold on a moment')
    }

    const faces = result.faceLandmarks ?? []
    const areas = faces.map((lm) => boxArea(lm))
    const count = countRealFaces(areas)
    const { yawDeg, pitchDeg } = headAnglesFromMatrix(result.facialTransformationMatrixes?.[0]?.data)
    const gaze = eyeGazeFromBlendshapes(result.faceBlendshapes?.[0]?.categories)
    this.lastObservation = { faceCount: count, yawDeg, pitchDeg, ...gaze }

    if (count > 1) {
      this.multiPersonStreak += 1
      this.noFaceStreak = 0
    } else if (count === 0) {
      this.noFaceStreak += 1
      this.multiPersonStreak = 0
    } else {
      this.multiPersonStreak = 0
      this.noFaceStreak = 0
    }

    if (count === 0) return buildStatus(0)
    const bestArea = Math.max(...areas)
    if (count === 1 && bestArea < TOO_FAR_RATIO) {
      return unable('Move closer and center your face')
    }
    const yaw = Math.max(-1, Math.min(1, yawDeg / YAW_FULL_SCALE_DEG))
    return buildStatus(count, { yaw, area: bestArea, lookingForward: Math.abs(yaw) < YAW_WARN })
  }

  dispose() {
    this.disposed = true
    this.lastObservation = null
  }
}
