/**
 * MediaPipe Face Landmarker for employer playback — red mesh when reviewing flagged intervals.
 */
import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { InterviewFlagSection } from './store'

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

/** Face oval + eye connectors (subset of tessellation — readable at review size). */
const RED_MESH_EDGES: Array<[number, number]> = [
  [10, 338],
  [338, 297],
  [297, 332],
  [332, 284],
  [284, 251],
  [251, 389],
  [389, 356],
  [356, 454],
  [454, 323],
  [323, 361],
  [361, 288],
  [288, 397],
  [397, 365],
  [365, 379],
  [379, 378],
  [378, 400],
  [400, 377],
  [377, 152],
  [152, 148],
  [148, 176],
  [176, 149],
  [149, 150],
  [150, 136],
  [136, 172],
  [172, 58],
  [58, 132],
  [132, 93],
  [93, 234],
  [234, 127],
  [127, 162],
  [162, 21],
  [21, 54],
  [54, 103],
  [103, 67],
  [67, 109],
  [109, 10],
  [33, 133],
  [133, 173],
  [173, 157],
  [157, 158],
  [158, 159],
  [159, 160],
  [160, 161],
  [161, 246],
  [246, 33],
  [263, 362],
  [362, 398],
  [398, 384],
  [384, 385],
  [385, 386],
  [386, 387],
  [387, 388],
  [388, 466],
  [466, 263],
]

let landmarkerPromise: Promise<FaceLandmarker | null> | null = null

export function getPlaybackFaceLandmarker(): Promise<FaceLandmarker | null> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_URL)
        for (const delegate of ['GPU', 'CPU'] as const) {
          try {
            return await FaceLandmarker.createFromOptions(vision, {
              baseOptions: { modelAssetPath: MODEL_URL, delegate },
              runningMode: 'VIDEO',
              numFaces: 3,
              outputFaceBlendshapes: false,
              outputFacialTransformationMatrixes: false,
            })
          } catch {
            /* try CPU */
          }
        }
      } catch (err) {
        console.warn('[proctor-playback] FaceLandmarker unavailable', err)
      }
      return null
    })()
  }
  return landmarkerPromise
}

export function flagAtTime(
  sections: InterviewFlagSection[],
  timeSec: number,
): InterviewFlagSection | null {
  for (const f of sections) {
    if (timeSec >= f.startSec - 0.05 && timeSec <= f.endSec + 0.05) return f
  }
  return null
}

function lmPoint(lm: NormalizedLandmark, w: number, h: number) {
  return { x: lm.x * w, y: lm.y * h }
}

export function drawRedFaceMesh(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
  mode: InterviewFlagSection['type'] | 'active',
) {
  const stroke =
    mode === 'MULTI_FACE' ? '#dc2626' : mode === 'NO_FACE' ? '#f97316' : '#ef4444'
  ctx.strokeStyle = stroke
  ctx.fillStyle = stroke
  ctx.lineWidth = 2

  for (const [a, b] of RED_MESH_EDGES) {
    const p1 = landmarks[a]
    const p2 = landmarks[b]
    if (!p1 || !p2) continue
    const s = lmPoint(p1, width, height)
    const e = lmPoint(p2, width, height)
    ctx.beginPath()
    ctx.moveTo(s.x, s.y)
    ctx.lineTo(e.x, e.y)
    ctx.stroke()
  }

  for (let i = 0; i < landmarks.length; i += 6) {
    const p = landmarks[i]
    if (!p) continue
    const { x, y } = lmPoint(p, width, height)
    ctx.beginPath()
    ctx.arc(x, y, 1.8, 0, Math.PI * 2)
    ctx.fill()
  }

  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0
  for (const pt of landmarks) {
    const { x, y } = lmPoint(pt, width, height)
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  ctx.strokeStyle = '#b91c1c'
  ctx.lineWidth = 3
  ctx.strokeRect(minX - 4, minY - 4, maxX - minX + 8, maxY - minY + 8)
}

export function clearOverlayCanvas(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
}
