/**
 * Single-person face tracking for the AI interview (lobby + room).
 *
 * One MediaPipe FaceLandmarker (with face blendshapes + facial transformation matrixes), shared by the live status
 * chip, the review-event log and the proctoring engine, so the room never runs two models. It runs in VIDEO mode on the
 * CPU delegate (the GPU delegate stalls the main thread on a synchronous readPixels every frame) against a small
 * downscaled frame; the page samples it at ~6 fps. The runtime and model come from the pinned CDN with a self-hosted
 * fallback (see mediapipeAssets.ts).
 */

import { ObjectDetector, type FaceLandmarker, type FaceLandmarkerResult } from '@mediapipe/tasks-vision'
import { createFaceLandmarker, type MediapipeLoadState, type WasmFileset } from './mediapipeAssets'

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

/** Raw per-frame measurements, consumed by the proctoring engine and the review-event log (same model, same frame). */
export type FaceObservation = {
  faceCount: number
  yawDeg: number
  pitchDeg: number
  gazeScore: number
  gazeDirection: 'left' | 'right' | 'center'
  /** Signed horizontal eye gaze from blendshapes, -1 (candidate's left) .. 1 (candidate's right). */
  eyeX?: number
  /** Signed vertical eye gaze from blendshapes, -1 (up) .. 1 (down). */
  eyeY?: number
  /** Iris offset from the centre of the eye opening (iris landmarks), -0.5 .. 0.5, averaged over both eyes. */
  irisX?: number
  /** Eyes-closed score 0..1. */
  blink?: number
  /** A phone was in the last object-detection pass (best effort; undefined when the detector is unavailable). */
  phoneDetected?: boolean
}

/** How often callers should sample (≈6 fps once inference time is added). */
export const FACE_SAMPLE_INTERVAL_MS = 150

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
let visionFileset: WasmFileset | null = null
let loadState: MediapipeLoadState = { status: 'idle' }

/** How the face model loaded (or why it did not). */
export function faceTrackerLoadState(): MediapipeLoadState {
  return loadState
}

/** COCO object detector, used only to notice a phone in view (proctoring review timeline). */
const PHONE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite'
/** Run phone detection on every Nth face sample (≈1 Hz at the ~6 fps face rate). */
const PHONE_EVERY_N_FRAMES = 6
let phoneDetectorPromise: Promise<ObjectDetector | null> | null = null
let phoneDetector: ObjectDetector | null = null

/** Loads in the background once the face model is up; a failed load just means no phone signal. */
function ensurePhoneDetector(): void {
  if (phoneDetectorPromise || !visionFileset) return
  const fileset = visionFileset
  phoneDetectorPromise = (async () => {
    try {
      phoneDetector = await ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: PHONE_MODEL_URL, delegate: 'CPU' },
        runningMode: 'VIDEO',
        categoryAllowlist: ['cell phone'],
        scoreThreshold: 0.5,
        maxResults: 1,
      })
      return phoneDetector
    } catch (err) {
      console.warn('[face-tracker] phone detector unavailable', err)
      return null
    }
  })()
}

async function getLandmarker(): Promise<FaceLandmarker | null> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const created = await createFaceLandmarker(
        {
          runningMode: 'VIDEO',
          numFaces: 3,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        },
        (state) => {
          loadState = state
        },
      )
      if (!created) return null
      visionFileset = created.fileset
      return created.landmarker
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

/**
 * Head yaw/pitch (degrees) from MediaPipe's 4x4 facial transformation matrix (column-major). The rotation columns are
 * normalised first: the matrix can carry scale, which would otherwise skew asin/atan2.
 */
export function headAnglesFromMatrix(matrixData?: ArrayLike<number>): { yawDeg: number; pitchDeg: number } {
  if (!matrixData || matrixData.length < 16) return { yawDeg: 0, pitchDeg: 0 }
  // Third column of the rotation = (r02, r12, r22).
  const r02 = matrixData[8]
  const r12 = matrixData[9]
  const r22 = matrixData[10]
  const scale = Math.hypot(r02, r12, r22)
  if (!Number.isFinite(scale) || scale < 1e-6) return { yawDeg: 0, pitchDeg: 0 }
  const yawDeg = Math.atan2(r02 / scale, r22 / scale) * (180 / Math.PI)
  const pitchDeg = Math.asin(-Math.max(-1, Math.min(1, r12 / scale))) * (180 / Math.PI)
  return { yawDeg, pitchDeg }
}

type Blendshape = { categoryName: string; score: number }

/**
 * Eye gaze from the eyeLook* blendshapes. eyeLookOutLeft / eyeLookInRight both mean "looking to the candidate's left",
 * eyeLookOutRight / eyeLookInLeft "to their right"; eyeLookDown and eyeLookUp are vertical.
 */
export function eyeGazeFromBlendshapes(categories?: Blendshape[]): {
  gazeScore: number
  gazeDirection: 'left' | 'right' | 'center'
  eyeX: number
  eyeY: number
  blink: number
} {
  if (!categories?.length) return { gazeScore: 0, gazeDirection: 'center', eyeX: 0, eyeY: 0, blink: 0 }
  const get = (name: string) => categories.find((c) => c.categoryName === name)?.score || 0
  const lookLeft = (get('eyeLookOutLeft') + get('eyeLookInRight')) / 2
  const lookRight = (get('eyeLookOutRight') + get('eyeLookInLeft')) / 2
  const down = (get('eyeLookDownLeft') + get('eyeLookDownRight')) / 2
  const up = (get('eyeLookUpLeft') + get('eyeLookUpRight')) / 2
  const eyeX = lookRight - lookLeft
  const gazeScore = Math.abs(eyeX)
  return {
    gazeScore,
    gazeDirection: gazeScore < 0.15 ? 'center' : eyeX < 0 ? 'left' : 'right',
    eyeX,
    eyeY: down - up,
    blink: (get('eyeBlinkLeft') + get('eyeBlinkRight')) / 2,
  }
}

/** Landmarks (478-point model with irises): eye corners and iris centres. */
const EYES = [
  { cornerA: 33, cornerB: 133, iris: 468 },
  { cornerA: 362, cornerB: 263, iris: 473 },
] as const

/**
 * Iris offset from the centre of the eye opening, -0.5..0.5 (0 = centred), averaged over both eyes; undefined when the
 * model returned no iris landmarks.
 */
export function irisOffsetFromLandmarks(landmarks?: ReadonlyArray<{ x: number; y: number }>): number | undefined {
  if (!landmarks || landmarks.length < 478) return undefined
  const offsets: number[] = []
  for (const eye of EYES) {
    const a = landmarks[eye.cornerA]
    const b = landmarks[eye.cornerB]
    const iris = landmarks[eye.iris]
    const left = Math.min(a.x, b.x)
    const width = Math.abs(a.x - b.x)
    if (!(width > 1e-4)) continue
    offsets.push((iris.x - left) / width - 0.5)
  }
  if (!offsets.length) return undefined
  return offsets.reduce((s, v) => s + v, 0) / offsets.length
}

/** Pure: turn one FaceLandmarker result into the per-frame observation (exposed for fixture tests). */
export function observationFromResult(result: Pick<FaceLandmarkerResult, 'faceLandmarks' | 'faceBlendshapes' | 'facialTransformationMatrixes'>): {
  observation: FaceObservation
  areas: number[]
} {
  const faces = result.faceLandmarks ?? []
  const areas = faces.map((lm) => boxArea(lm))
  const count = countRealFaces(areas)
  // Measure the main (largest) face, not whichever face the model listed first.
  const main = areas.length ? areas.indexOf(Math.max(...areas)) : -1
  if (main < 0) {
    return { observation: { faceCount: 0, yawDeg: 0, pitchDeg: 0, gazeScore: 0, gazeDirection: 'center' }, areas }
  }
  const { yawDeg, pitchDeg } = headAnglesFromMatrix(result.facialTransformationMatrixes?.[main]?.data)
  const gaze = eyeGazeFromBlendshapes(result.faceBlendshapes?.[main]?.categories)
  return {
    observation: { faceCount: count, yawDeg, pitchDeg, ...gaze, irisX: irisOffsetFromLandmarks(faces[main]) },
    areas,
  }
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

/** Status label (and review-event message) when there is no working camera at all. */
export const CAMERA_UNAVAILABLE = 'Camera unavailable — check that it is connected and allowed'

/** False when the element has no camera stream or its video track has ended (unplugged, permission revoked). */
function cameraLive(video: HTMLVideoElement): boolean {
  const src = video.srcObject as MediaStream | null
  if (!src) return Boolean(video.src)
  const tracks = typeof src.getVideoTracks === 'function' ? src.getVideoTracks() : []
  return tracks.some((t) => t.readyState === 'live')
}

export class FaceTracker {
  private lastTs = -1
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private videoTime = -1
  private frameAt = performance.now()
  private disposed = false
  private phoneTs = -1
  private phoneFrame = 0
  private phoneSeen: boolean | undefined = undefined
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
    if (this.disposed) return SCANNING
    if (!video || !cameraLive(video)) return unable(CAMERA_UNAVAILABLE)
    if (video.readyState < 2 || !video.videoWidth) return unable('Waiting for your camera…')
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

    const { observation, areas } = observationFromResult(result)
    const count = observation.faceCount
    this.lastObservation = { ...observation, phoneDetected: this.detectPhone(canvas) }

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
    const yaw = Math.max(-1, Math.min(1, observation.yawDeg / YAW_FULL_SCALE_DEG))
    return buildStatus(count, { yaw, area: bestArea, lookingForward: Math.abs(yaw) < YAW_WARN })
  }

  /** Best-effort phone check on the same downscaled frame, about once a second. */
  private detectPhone(canvas: HTMLCanvasElement): boolean | undefined {
    ensurePhoneDetector()
    if (!phoneDetector) return undefined
    this.phoneFrame = (this.phoneFrame + 1) % PHONE_EVERY_N_FRAMES
    if (this.phoneFrame !== 0) return this.phoneSeen
    let ts = Math.floor(performance.now())
    if (ts <= this.phoneTs) ts = this.phoneTs + 1
    this.phoneTs = ts
    try {
      this.phoneSeen = phoneDetector.detectForVideo(canvas, ts).detections.length > 0
    } catch {
      this.phoneSeen = undefined
    }
    return this.phoneSeen
  }

  dispose() {
    this.disposed = true
    this.lastObservation = null
  }
}
