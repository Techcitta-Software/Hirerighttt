/**
 * Silero VAD (browser) segments speech; each finished phrase is sent to Groq Whisper via the API.
 */

import {
  MicVAD,
  getDefaultRealTimeVADOptions,
  utils,
  type RealTimeVADOptions,
} from '@ricky0123/vad-web'
import { transcribeInterviewChunk } from './groqTranscribe'
import type { RecognitionMerge } from './speech'

const VAD_CDN = 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.31/dist/'
const ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/'

/** Short pause ends a phrase → Groq chunk (still accurate, faster than full sentences). */
const SENTENCE_REDEMPTION_MS = 550
const MIN_SPEECH_MS = 220

export type SileroGroqSttHandlers = {
  onTranscript: (display: string, merged: RecognitionMerge) => void
  onBargeIn?: () => void
  onError?: (message: string) => void
  onListeningChange?: (active: boolean) => void
  onTranscribingChange?: (active: boolean) => void
  shouldRun: () => boolean
  isAiSpeaking: () => boolean
  getStream: () => MediaStream | null
}

export type SileroGroqSttController = {
  start: () => Promise<void>
  stop: () => Promise<void>
  resetTranscript: (base?: string) => void
  dispose: () => Promise<void>
}

function emptyMerge(committed: string, interim = ''): RecognitionMerge {
  return {
    committed,
    interim,
    bargeIn: false,
    hadFinal: Boolean(committed.trim()),
  }
}

export function createSileroGroqSttController(
  handlers: SileroGroqSttHandlers,
): SileroGroqSttController {
  let vad: MicVAD | null = null
  let initPromise: Promise<MicVAD> | null = null
  let committed = ''
  let speakingNow = false
  let transcribingCount = 0
  let disposed = false

  const pushDisplay = (interimSuffix = '') => {
    const interim = speakingNow ? '…' : transcribingCount > 0 ? ' …' : ''
    const display = `${committed}${interimSuffix || interim}`.trim()
    handlers.onTranscript(display, emptyMerge(committed, interimSuffix || interim))
  }

  const setTranscribing = (delta: number) => {
    transcribingCount = Math.max(0, transcribingCount + delta)
    handlers.onTranscribingChange?.(transcribingCount > 0)
    pushDisplay()
  }

  const flushSegment = async (audio: Float32Array) => {
    if (disposed || audio.length < 1600) return
    setTranscribing(1)
    try {
      const wavBuffer = utils.encodeWAV(audio, 1, 16000, 1, 16)
      const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' })
      const { text } = await transcribeInterviewChunk(wavBlob)
      const cleaned = text.trim()
      if (cleaned) {
        committed = committed ? `${committed} ${cleaned}` : cleaned
        handlers.onTranscript(
          committed,
          emptyMerge(committed, ''),
        )
      }
    } catch (err) {
      handlers.onError?.(
        err instanceof Error ? err.message : 'Could not transcribe this phrase.',
      )
    } finally {
      setTranscribing(-1)
    }
  }

  const buildVad = async (): Promise<MicVAD> => {
    const defaults = getDefaultRealTimeVADOptions('v5') as RealTimeVADOptions
    const instance = await MicVAD.new({
      ...defaults,
      model: 'v5',
      baseAssetPath: VAD_CDN,
      onnxWASMBasePath: ORT_CDN,
      startOnLoad: false,
      redemptionMs: SENTENCE_REDEMPTION_MS,
      minSpeechMs: MIN_SPEECH_MS,
      positiveSpeechThreshold: 0.45,
      negativeSpeechThreshold: 0.28,
      preSpeechPadMs: 300,
      getStream: async () => {
        const stream = handlers.getStream()
        if (!stream) throw new Error('Microphone stream is not ready.')
        const audioTracks = stream.getAudioTracks()
        if (!audioTracks.length) throw new Error('No audio track on microphone stream.')
        return stream
      },
      pauseStream: async () => {
        /* Keep shared interview stream alive for video + recording */
      },
      resumeStream: async () => {
        const stream = handlers.getStream()
        if (!stream) throw new Error('Microphone stream is not ready.')
        return stream
      },
      onSpeechStart: () => {
        speakingNow = true
        handlers.onListeningChange?.(true)
        if (handlers.isAiSpeaking()) handlers.onBargeIn?.()
        pushDisplay()
      },
      onSpeechRealStart: () => {
        if (handlers.isAiSpeaking()) handlers.onBargeIn?.()
      },
      onSpeechEnd: (audio) => {
        speakingNow = false
        handlers.onListeningChange?.(true)
        void flushSegment(audio)
      },
      onVADMisfire: () => {
        speakingNow = false
        pushDisplay()
      },
    })
    return instance
  }

  const ensureVad = async (): Promise<MicVAD> => {
    if (vad) return vad
    if (!initPromise) initPromise = buildVad()
    vad = await initPromise
    return vad
  }

  const start = async () => {
    if (disposed || !handlers.shouldRun()) return
    if (handlers.isAiSpeaking()) return
    try {
      const instance = await ensureVad()
      if (disposed) return
      await instance.start()
      handlers.onListeningChange?.(true)
    } catch (err) {
      handlers.onError?.(
        err instanceof Error ? err.message : 'Silero VAD failed to start.',
      )
      handlers.onListeningChange?.(false)
    }
  }

  const stop = async () => {
    speakingNow = false
    try {
      await vad?.pause()
    } catch {
      // ignore
    }
    handlers.onListeningChange?.(false)
  }

  const resetTranscript = (base = '') => {
    committed = base.trim()
    pushDisplay()
  }

  const dispose = async () => {
    disposed = true
    speakingNow = false
    transcribingCount = 0
    try {
      await vad?.destroy()
    } catch {
      // ignore
    }
    vad = null
    initPromise = null
    handlers.onListeningChange?.(false)
    handlers.onTranscribingChange?.(false)
  }

  return { start, stop, resetTranscript, dispose }
}

export function sileroGroqSttHint(): string {
  return 'Live captions: Silero VAD detects your voice; Groq Whisper transcribes each phrase.'
}
