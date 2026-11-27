/**
 * Silero VAD (@ricky0123/vad-web) + on-device Moonshine Tiny (Transformers.js WASM).
 */

import { MicVAD } from '@ricky0123/vad-web'
import { moonshineStt } from './moonshineStt'

const VAD_PKG_VERSION = '0.0.31'
const ORT_WASM_VERSION = '1.30.0'
/** Match moonshineStt / Silero VAD output (16 kHz). */
const MIN_VAD_SAMPLES = 4000

export type MoonshineVadSttHandlers = {
  getStream: () => MediaStream | null
  /** `captureEndedAt` is Date.now() from the start of onSpeechEnd, before transcribeAudio. */
  onSegmentText: (text: string, captureEndedAt?: number) => void
  onSpeechCaptureStart?: () => void
  onSpeechCaptureEnd?: () => void
  onTranscribing?: (active: boolean) => void
  onSpeechStart?: () => void
  isAiSpeaking: () => boolean
  onError?: (message: string) => void
  /** Moonshine failed or returned no text — UI can fall back to keyboard / Web Speech. */
  onTranscriptionMiss?: (reason: string) => void
}

export type MoonshineVadSttController = {
  start: () => Promise<void>
  stop: () => Promise<void>
  dispose: () => Promise<void>
  /** Wait for the in-flight transcribeAudio, or resolve immediately when there is none. Gives up at maxMs. */
  joinTranscript: (maxMs: number) => Promise<void>
  transcribeInFlight: () => boolean
}

export async function createMoonshineVadSttController(
  handlers: MoonshineVadSttHandlers,
): Promise<MoonshineVadSttController | null> {
  try {
    const inflight = new Set<Promise<void>>()
    const vad = await MicVAD.new({
      startOnLoad: false,
      baseAssetPath: `https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@${VAD_PKG_VERSION}/dist/`,
      onnxWASMBasePath: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_WASM_VERSION}/dist/`,
      getStream: async () => {
        const stream = handlers.getStream()
        if (!stream?.getAudioTracks().some((t) => t.readyState === 'live')) {
          throw new Error('Microphone stream is not ready.')
        }
        return stream
      },
      pauseStream: async () => undefined,
      resumeStream: async (stream: MediaStream) => stream,
      onSpeechStart: () => {
        handlers.onSpeechStart?.()
      },
      onSpeechRealStart: () => {
        handlers.onSpeechCaptureStart?.()
      },
      onSpeechEnd: (audio: Float32Array) => {
        const captureEndedAt = Date.now()
        // Too short to transcribe: do not keep a promise, and do not leave the phase on "capturing".
        if (!audio?.length || audio.length < MIN_VAD_SAMPLES) {
          handlers.onTranscribing?.(false)
          return
        }
        const work = (async () => {
          handlers.onTranscribing?.(true)
          try {
            const { text } = await moonshineStt.transcribeAudio(audio)
            if (text?.trim()) {
              handlers.onSegmentText(text, captureEndedAt)
            } else {
              handlers.onTranscriptionMiss?.('No speech detected in that segment.')
            }
          } catch (err) {
            const message =
              err instanceof Error ? err.message : 'Voice transcription failed.'
            handlers.onError?.(message)
            handlers.onTranscriptionMiss?.(message)
          } finally {
            handlers.onTranscribing?.(false)
          }
        })()
        // pause/stop must not abort, drop, or skip a transcription that has already started.
        inflight.add(work)
        void work.finally(() => {
          inflight.delete(work)
        })
      },
    })

    let destroyed = false
    return {
      start: async () => {
        await vad.start()
      },
      joinTranscript: (maxMs: number) => {
        const deadline = Date.now() + Math.max(0, maxMs)
        const wait = async () => {
          while (inflight.size > 0 && Date.now() < deadline) {
            const current = [...inflight]
            const remaining = deadline - Date.now()
            if (remaining <= 0) break
            await new Promise<void>((resolve) => {
              const timer = window.setTimeout(resolve, remaining)
              Promise.all(current).then(
                () => {
                  window.clearTimeout(timer)
                  resolve()
                },
                () => {
                  window.clearTimeout(timer)
                  resolve()
                },
              )
            })
          }
        }
        return wait()
      },
      transcribeInFlight: () => inflight.size > 0,
      // pause/destroy throw "MicVAD has null stream, audio context, or processor adapter" when the stream or audio
      // context is already gone (leaving the room). Nothing is left to stop then, so swallow it.
      // stop does not abort or forget an in-flight transcribeAudio promise.
      stop: async () => {
        if (destroyed) return
        try {
          await vad.pause()
        } catch {
          // already torn down
        }
      },
      dispose: async () => {
        if (destroyed) return
        destroyed = true
        try {
          await vad.destroy()
        } catch {
          // already torn down
        }
      },
    }
  } catch (err) {
    handlers.onError?.(
      err instanceof Error ? err.message : 'Silero VAD failed to initialize.',
    )
    return null
  }
}

export function moonshineVadSttHint(): string {
  return 'Voice answers — pause when you finish speaking to move on.'
}
