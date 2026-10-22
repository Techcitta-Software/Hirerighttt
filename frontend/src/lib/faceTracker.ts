/**
 * Single-person face tracking for the AI interview studio.
 * Full-range BlazeFace + stable timestamps so detection does not falsely "pause".
 */

import {
  FaceDetector,
  FilesetResolver,
  type Detection,
} from '@mediapipe/tasks-vision'

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
  yaw: number
  lookingForward: boolean
}

/** Match installed @mediapipe/tasks-vision version (see package.json). */
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'

/** Short-range = best for webcam/selfie (closer faces). */
const SHORT_RANGE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'

/** Full-range = farther faces / angled views. */
const FULL_RANGE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/1/blaze_face_full_range.tflite'

const KP = {
  RIGHT_EYE: 0,
  LEFT_EYE: 1,
  NOSE: 2,
  MOUTH: 3,
  RIGHT_EAR: 4,
  LEFT_EAR: 5,
} as const

const TOO_FAR_RATIO = 0.035
const VERY_FAR_RATIO = 0.018
const YAW_WARN = 0.32
const YAW_STRONG = 0.48

let detectorPromise: Promise<FaceDetector | null> | null = null

async function createDetector(
  modelUrl: string,
  delegate: 'GPU' | 'CPU',
): Promise<FaceDetector> {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL)
  return FaceDetector.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: modelUrl,
      delegate,
    },
    runningMode: 'VIDEO',
    minDetectionConfidence: 0.4,
    minSuppressionThreshold: 0.3,
  })
}

async function getDetector(): Promise<FaceDetector | null> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      // Prefer short-range for interview webcam distance; fall back to full-range / CPU.
      const attempts: Array<{ model: string; delegate: 'GPU' | 'CPU' }> = [
        { model: SHORT_RANGE_MODEL, delegate: 'GPU' },
        { model: SHORT_RANGE_MODEL, delegate: 'CPU' },
        { model: FULL_RANGE_MODEL, delegate: 'GPU' },
        { model: FULL_RANGE_MODEL, delegate: 'CPU' },
      ]
      for (const attempt of attempts) {
        try {
          return await createDetector(attempt.model, attempt.delegate)
        } catch (err) {
          console.warn(
            `[face-tracker] init failed (${attempt.delegate}, ${attempt.model.includes('full') ? 'full' : 'short'})`,
            err,
          )
        }
      }
      return null
    })()
  }
  return detectorPromise
}

function kp(
  detection: Detection,
  index: number,
): { x: number; y: number } | null {
  const points = detection.keypoints
  if (!points || !points[index]) return null
  const p = points[index]
  if (typeof p.x !== 'number' || typeof p.y !== 'number') return null
  return { x: p.x, y: p.y }
}

function estimateYaw(detection: Detection): number {
  const re = kp(detection, KP.RIGHT_EYE)
  const le = kp(detection, KP.LEFT_EYE)
  const nose = kp(detection, KP.NOSE)
  if (!re || !le || !nose) return 0

  const eyeSpan = Math.abs(le.x - re.x)
  if (eyeSpan < 0.01) return 0

  const midX = (le.x + re.x) / 2
  let yaw = (nose.x - midX) / (eyeSpan * 0.5)

  const rEar = kp(detection, KP.RIGHT_EAR)
  const lEar = kp(detection, KP.LEFT_EAR)
  if (rEar && lEar) {
    const dR = Math.hypot(nose.x - rEar.x, nose.y - rEar.y)
    const dL = Math.hypot(nose.x - lEar.x, nose.y - lEar.y)
    const earBias = (dL - dR) / Math.max(dL + dR, 0.01)
    yaw = yaw * 0.55 + earBias * 0.45
  }

  return Math.max(-1, Math.min(1, yaw))
}

function faceAreaRatio(detection: Detection, video: HTMLVideoElement): number {
  const box = detection.boundingBox
  if (!box) return 0
  const vw = video.videoWidth || 1
  const vh = video.videoHeight || 1
  const w = 'width' in box ? Number(box.width) : 0
  const h = 'height' in box ? Number(box.height) : 0
  if (w <= 1 && h <= 1) return Math.max(0, w * h)
  return Math.max(0, (w * h) / (vw * vh))
}

function buildStatus(
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
      label: 'No face found — center yourself in the camera',
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
      label: `${faceCount} people in frame — only you are allowed`,
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
      label: 'Turn toward the camera — keep your face centered',
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
      label: 'You look too far — move closer so Ava can see you clearly',
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
      label: 'A bit far — scoot closer to the camera',
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
    label: 'One face detected · facing camera',
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
  label: 'Scanning for your face…',
  severity: 'warn',
  issue: 'scanning',
  faceAreaRatio: 0,
  yaw: 0,
  lookingForward: false,
}

export class FaceTracker {
  private lastTs = -1
  private canvas = document.createElement('canvas')
  private videoTime = -1
  private frameAt = performance.now()
  private lastStatus: FaceTrackStatus = SCANNING
  private disposed = false
  private errorStreak = 0
  multiPersonStreak = 0
  noFaceStreak = 0

  async ready() {
    return (await getDetector()) != null
  }

  async detect(video: HTMLVideoElement | null): Promise<FaceTrackStatus> {
    if (this.disposed || !video || video.readyState < 2 || !video.videoWidth) {
      return { ...SCANNING, issue: 'unable_to_assess', label: 'Unable to assess: camera frame unavailable.' }
    }
    if (video.currentTime !== this.videoTime) { this.videoTime = video.currentTime; this.frameAt = performance.now() }
    if (document.hidden || performance.now() - this.frameAt > 1500) {
      return { ...SCANNING, issue: 'unable_to_assess', label: 'Unable to assess: video paused or page hidden.' }
    }
    this.canvas.width = 64
    this.canvas.height = 48
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true })
    if (ctx) {
      ctx.drawImage(video, 0, 0, 64, 48)
      const data = ctx.getImageData(0, 0, 64, 48).data
      let sum = 0, squares = 0
      for (let i = 0; i < data.length; i += 4) {
        const l = .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2]
        sum += l; squares += l * l
      }
      const mean = sum / (64 * 48)
      if (mean < 35 || mean > 235 || squares / (64 * 48) - mean * mean < 70) {
        return { ...SCANNING, issue: 'unable_to_assess', label: 'Unable to assess: improve lighting and keep the lens clear.' }
      }
    }

    const detector = await getDetector()
    if (!detector) {
      this.lastStatus = {
        faceCount: 0,
        ok: false,
        label: 'Unable to assess: camera checks unavailable. Refresh to retry.',
        severity: 'warn',
        issue: 'engine_off',
        faceAreaRatio: 0,
        yaw: 0,
        lookingForward: true,
      }
      return this.lastStatus
    }

    // MediaPipe VIDEO mode requires strictly increasing timestamps (ms).
    let ts = Math.floor(performance.now())
    if (ts <= this.lastTs) ts = this.lastTs + 1
    this.lastTs = ts

    try {
      const result = detector.detectForVideo(video, ts)
      this.errorStreak = 0
      const detections = (result.detections as Detection[] | undefined) ?? []
      if (detections.some(d => (d.categories?.[0]?.score ?? 0) < .65)) {
        return { ...SCANNING, issue: 'unable_to_assess', label: 'Unable to assess: low detection confidence.' }
      }
      const count = detections.length

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

      let primary = detections[0]
      let bestArea = faceAreaRatio(primary, video)
      for (let i = 1; i < detections.length; i += 1) {
        const a = faceAreaRatio(detections[i], video)
        if (a > bestArea) {
          bestArea = a
          primary = detections[i]
        }
      }

      if (bestArea < TOO_FAR_RATIO) return { ...SCANNING, issue: 'unable_to_assess', label: 'Unable to assess: move closer and center your face.' }
      const yaw = estimateYaw(primary)
      const lookingForward = Math.abs(yaw) < YAW_WARN
      this.lastStatus = buildStatus(count, {
        yaw,
        area: bestArea,
        lookingForward,
      })
      return this.lastStatus
    } catch (err) {
      this.errorStreak += 1
      console.warn('[face-tracker] detect error', err)
      return { ...SCANNING, issue: 'unable_to_assess', label: 'Unable to assess: camera analysis interrupted.' }
    }
  }

  dispose() {
    this.disposed = true
  }
}
