import { pipeline, env } from '@huggingface/transformers'
import { onnxWasmThreadCount } from './onnxWasmThreads'

env.useBrowserCache = true
env.allowLocalModels = false

if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.numThreads = onnxWasmThreadCount()
}

const MODEL_ID = 'onnx-community/moonshine-tiny-ONNX'
const HF_BASE_URL = `https://huggingface.co/${MODEL_ID}/resolve/main`

/** Silero VAD segments are 16 kHz mono; Moonshine expects the same. */
const MOONSHINE_SAMPLE_RATE = 16_000
const MIN_TRANSCRIBE_SAMPLES = 4000

const GRADUAL_FILES = [
  { path: 'config.json', weight: 2 },
  { path: 'preprocessor_config.json', weight: 2 },
  { path: 'generation_config.json', weight: 2 },
  { path: 'tokenizer_config.json', weight: 2 },
  { path: 'tokenizer.json', weight: 7 },
  { path: 'onnx/encoder_model_quantized.onnx', weight: 30 },
  { path: 'onnx/decoder_model_merged_quantized.onnx', weight: 55 },
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let transcriber: any = null
let initPromise: Promise<void> | null = null

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function cacheFileGradually(
  cache: Cache,
  fileUrl: string,
  onChunkProgress: (ratio: number) => void,
) {
  const existing = await cache.match(fileUrl)
  if (existing) {
    onChunkProgress(1)
    return
  }

  const response = await fetch(fileUrl, { priority: 'low' } as RequestInit)
  if (!response.ok || !response.body) {
    onChunkProgress(1)
    return
  }

  const contentLength = Number(response.headers.get('Content-Length')) || 0
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let receivedLength = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      receivedLength += value.length
      if (contentLength > 0) {
        onChunkProgress(Math.min(1, receivedLength / contentLength))
      }
    }
  }

  const blob = new Blob(chunks as BlobPart[], {
    type: response.headers.get('Content-Type') || 'application/octet-stream',
  })

  await cache.put(
    fileUrl,
    new Response(blob, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
  )
  onChunkProgress(1)
}

async function initMoonshineTiny(): Promise<void> {
  if (transcriber) {
    self.postMessage({ type: 'READY', modelId: MODEL_ID })
    return
  }
  if (initPromise) {
    await initPromise
    return
  }

  initPromise = (async () => {
  try {
    if (typeof caches !== 'undefined') {
      const cache = await caches.open('transformers-cache')
      let completedWeight = 0

      for (const file of GRADUAL_FILES) {
        const url = `${HF_BASE_URL}/${file.path}`
        await cacheFileGradually(cache, url, (fileRatio) => {
          const totalPercent = Math.min(95, Math.round(completedWeight + file.weight * fileRatio))
          self.postMessage({
            type: 'PROGRESS',
            percent: totalPercent,
            stage: `Caching ${file.path.split('/').pop()}`,
          })
        })
        completedWeight += file.weight
        await sleep(350)
      }
    }

    transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: (ev: { status?: string; progress?: number; file?: string }) => {
        if (ev.status === 'progress' && typeof ev.progress === 'number') {
          self.postMessage({
            type: 'PROGRESS',
            percent: Math.min(98, Math.round(ev.progress)),
            stage: `Loading ${ev.file || 'model'}`,
          })
        }
      },
    })

    const silentWarmup = new Float32Array(8000)
    await transcriber(silentWarmup, { sampling_rate: MOONSHINE_SAMPLE_RATE })

    self.postMessage({ type: 'PROGRESS', percent: 100, stage: 'Ready' })
    self.postMessage({ type: 'READY', modelId: MODEL_ID })
  } catch (err: unknown) {
    self.postMessage({
      type: 'ERROR',
      error: err instanceof Error ? err.message : 'Moonshine Tiny initialization failed',
    })
    throw err
  }
  })()

  try {
    await initPromise
  } catch {
    initPromise = null
  }
}

self.onmessage = async (event: MessageEvent) => {
  const { action, audioFloat32, requestId } = event.data as {
    action?: string
    audioFloat32?: Float32Array
    requestId?: string
  }

  if (action === 'GRADUAL_PRELOAD') {
    await initMoonshineTiny()
    return
  }

  if (action === 'TRANSCRIBE') {
    try {
      if (!transcriber) {
        await initMoonshineTiny()
      }
      if (!transcriber) {
        throw new Error('Moonshine model not loaded')
      }
      const t0 = performance.now()
      if (!audioFloat32 || audioFloat32.length < MIN_TRANSCRIBE_SAMPLES) {
        self.postMessage({
          type: 'TRANSCRIPT_RESULT',
          requestId,
          text: '',
          latencyMs: 0,
        })
        return
      }
      const output = await transcriber(audioFloat32, {
        sampling_rate: MOONSHINE_SAMPLE_RATE,
      })
      const latencyMs = Math.round(performance.now() - t0)

      self.postMessage({
        type: 'TRANSCRIPT_RESULT',
        requestId,
        text: String(output?.text || '').trim(),
        latencyMs,
      })
    } catch (err: unknown) {
      self.postMessage({
        type: 'TRANSCRIPT_ERROR',
        requestId,
        error: err instanceof Error ? err.message : 'Moonshine transcription failed',
      })
    }
  }
}
