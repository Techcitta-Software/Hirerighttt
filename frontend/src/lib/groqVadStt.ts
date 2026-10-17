/**
 * Silero VAD (@ricky0123/vad-web) + Groq Whisper via server `/api/interview/transcribe`.
 */

import { MicVAD, utils } from '@ricky0123/vad-web'
import { apiFetch } from './api'

const VAD_PKG_VERSION = '0.0.31'
const ORT_WASM_VERSION = '1.30.0'

export type GroqVadSttHandlers = {
  getStream: () => MediaStream | null
  onSegmentText: (text: string) => void
  /** Silero detected speech (candidate is talking). */
  onSpeechCaptureStart?: () => void
  /** Speech segment ended — about to send audio to Groq Whisper. */
  onSpeechCaptureEnd?: () => void
  /** Groq Whisper request in flight for the latest segment. */
  onTranscribing?: (active: boolean) => void
  onSpeechStart?: () => void
  onBargeIn?: () => void
  isAiSpeaking: () => boolean
  onError?: (message: string) => void
}

export type GroqVadSttController = {
  start: () => Promise<void>
  stop: () => Promise<void>
  dispose: () => Promise<void>
}

async function transcribeWavBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  const audioBase64 = btoa(binary)

  const res = await apiFetch('/api/interview/transcribe', {
    method: 'POST',
    body: JSON.stringify({
      audioBase64,
      mimeType: 'audio/wav',
      filename: 'speech.wav',
    }),
  })
  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string }
  if (!res.ok) throw new Error(data.error || `Transcription failed (${res.status})`)
  return String(data.text || '').trim()
}

export async function createGroqVadSttController(
  handlers: GroqVadSttHandlers,
): Promise<GroqVadSttController | null> {
  try {
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
      /** Shared with interview video — never stop tracks on pause. */
      pauseStream: async () => undefined,
      resumeStream: async (stream) => stream,
      onSpeechStart: () => {
        if (handlers.isAiSpeaking()) handlers.onBargeIn?.()
        else handlers.onSpeechStart?.()
      },
      onSpeechRealStart: () => {
        if (!handlers.isAiSpeaking()) handlers.onSpeechCaptureStart?.()
      },
      onSpeechEnd: async (audio: Float32Array) => {
        handlers.onSpeechCaptureEnd?.()
        try {
          if (!audio?.length) return
          const wavBuffer = utils.encodeWAV(audio)
          const blob = new Blob([wavBuffer], { type: 'audio/wav' })
          if (blob.size < 1200) return
          handlers.onTranscribing?.(true)
          const text = await transcribeWavBlob(blob)
          if (text) handlers.onSegmentText(text)
        } catch (err) {
          handlers.onError?.(
            err instanceof Error ? err.message : 'Voice transcription failed.',
          )
        } finally {
          handlers.onTranscribing?.(false)
        }
      },
    })

    return {
      start: async () => {
        await vad.start()
      },
      stop: async () => {
        await vad.pause()
      },
      dispose: async () => {
        await vad.destroy()
      },
    }
  } catch (err) {
    handlers.onError?.(
      err instanceof Error ? err.message : 'Silero VAD failed to initialize.',
    )
    return null
  }
}

export function groqVadSttHint(): string {
  return 'Voice captions (Silero VAD + Groq Whisper) — pause ~5 seconds when finished to advance.'
}
