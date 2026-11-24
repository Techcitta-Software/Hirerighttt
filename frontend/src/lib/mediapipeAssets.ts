/**
 * Where the MediaPipe Tasks Vision runtime and the face model are loaded from.
 *
 * Primary: the CDN, pinned to the exact npm version installed (a mismatched WASM build fails at runtime).
 * Fallback: self-hosted copies. The WASM loader and binary come from the npm package itself (Vite emits them as
 * build assets, so they always match the JS bundle) and the face model lives in `public/mediapipe/`. Each source gets a
 * time limit, so a CDN that hangs falls through to the local copy instead of leaving the interview without proctoring.
 */
import { FaceLandmarker, FilesetResolver, type FaceLandmarkerOptions } from '@mediapipe/tasks-vision'
import localWasmLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import localWasmBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'

/** The runtime file locations MediaPipe tasks are created from (the type is not exported by the package). */
export type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>

/** Must equal the installed @mediapipe/tasks-vision version (checked by mediapipeAssets.test.ts). */
export const MEDIAPIPE_VERSION = '1.0.1'
export const CDN_WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`
export const CDN_FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
export const LOCAL_FACE_MODEL_URL = '/mediapipe/face_landmarker.task'

/** Per-source time limit for fetching + compiling the runtime and model. */
const SOURCE_TIMEOUT_MS = 20_000

export type FaceModelSource = 'cdn' | 'local'
export type MediapipeLoadState = {
  status: 'idle' | 'loading' | 'ready' | 'failed'
  source?: FaceModelSource
  delegate?: 'CPU' | 'GPU'
  error?: string
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

export type FaceLandmarkerSource = { source: FaceModelSource; fileset: () => Promise<WasmFileset>; modelUrl: string }

export function faceLandmarkerSources(): FaceLandmarkerSource[] {
  return [
    { source: 'cdn', fileset: () => FilesetResolver.forVisionTasks(CDN_WASM_BASE), modelUrl: CDN_FACE_MODEL_URL },
    {
      source: 'local',
      fileset: async () => ({ wasmLoaderPath: localWasmLoaderUrl, wasmBinaryPath: localWasmBinaryUrl }),
      modelUrl: LOCAL_FACE_MODEL_URL,
    },
  ]
}

/**
 * Creates a FaceLandmarker, trying CDN then self-hosted assets, and for each the CPU delegate first (the GPU delegate
 * blocks the main thread on a synchronous readPixels every frame), then GPU. Never throws: null means unavailable,
 * and `onState` says why.
 */
export async function createFaceLandmarker(
  options: Omit<FaceLandmarkerOptions, 'baseOptions'>,
  onState?: (state: MediapipeLoadState) => void,
  sources: FaceLandmarkerSource[] = faceLandmarkerSources(),
): Promise<{ landmarker: FaceLandmarker; source: FaceModelSource; fileset: WasmFileset } | null> {
  const errors: string[] = []
  onState?.({ status: 'loading' })
  for (const src of sources) {
    let fileset: WasmFileset
    try {
      fileset = await withTimeout(src.fileset(), SOURCE_TIMEOUT_MS, `${src.source} runtime`)
    } catch (err) {
      errors.push(`${src.source} runtime: ${String((err as Error)?.message || err)}`)
      console.warn(`[mediapipe] ${src.source} runtime unavailable`, err)
      continue
    }
    for (const delegate of ['CPU', 'GPU'] as const) {
      try {
        const landmarker = await withTimeout(
          FaceLandmarker.createFromOptions(fileset, {
            ...options,
            baseOptions: { modelAssetPath: src.modelUrl, delegate },
          }),
          SOURCE_TIMEOUT_MS,
          `${src.source} model (${delegate})`,
        )
        onState?.({ status: 'ready', source: src.source, delegate })
        return { landmarker, source: src.source, fileset }
      } catch (err) {
        errors.push(`${src.source} ${delegate}: ${String((err as Error)?.message || err)}`)
        console.warn(`[mediapipe] face model failed (${src.source}, ${delegate})`, err)
      }
    }
  }
  onState?.({ status: 'failed', error: errors.join('; ').slice(0, 500) })
  return null
}
