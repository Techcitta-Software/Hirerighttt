/**
 * Live interview captions: fast browser interim (~100–300ms) + Groq Whisper (Silero VAD / streaming).
 */

import { createInterviewSttController } from './interviewStt'
import { createSileroGroqSttController } from './sileroGroqStt'
import { transcribeInterviewChunk } from './groqTranscribe'
import { appendGroqDelta, mergeLiveCaption } from './mergeLiveCaption'
import { isSpeechRecognitionSupported, type RecognitionMerge } from './speech'

const GROQ_STREAM_MS = 450
const MIN_STREAM_BLOB_BYTES = 800

export type LiveInterviewSttHandlers = {
  onTranscript: (display: string, merged: RecognitionMerge) => void
  onBargeIn?: () => void
  onError?: (message: string, code?: string) => void
  onListeningChange?: (active: boolean) => void
  onTranscribingChange?: (active: boolean) => void
  shouldRun: () => boolean
  isAiSpeaking: () => boolean
  getStream: () => MediaStream | null
}

export type LiveInterviewSttController = {
  start: () => Promise<void>
  stop: () => void
  resetTranscript: (base?: string) => void
  dispose: () => void
}

function emptyMerge(committed: string, interim = ''): RecognitionMerge {
  return {
    committed,
    interim,
    bargeIn: false,
    hadFinal: Boolean(committed.trim()),
  }
}

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
  return candidates.find((t) => MediaRecorder.isTypeSupported(t))
}

export function createLiveInterviewSttController(
  handlers: LiveInterviewSttHandlers,
): LiveInterviewSttController {
  let groqCommitted = ''
  let browserLive = ''
  let groqPartial = ''
  let browserListening = false
  let groqListening = false
  let streamListening = false
  let disposed = false

  let streamRecorder: MediaRecorder | null = null
  let streamSeq = 0
  let groqInflight = 0

  const sync = () => {
    const display = mergeLiveCaption(groqCommitted, browserLive, groqPartial)
    handlers.onTranscript(
      display,
      emptyMerge(groqCommitted, browserLive || groqPartial),
    )
  }

  const setListening = () => {
    const active = browserListening || groqListening || streamListening
    handlers.onListeningChange?.(active)
  }

  const setTranscribing = () => {
    handlers.onTranscribingChange?.(groqInflight > 0)
  }

  const browser =
    isSpeechRecognitionSupported()
      ? createInterviewSttController({
          shouldRun: handlers.shouldRun,
          isAiSpeaking: handlers.isAiSpeaking,
          onBargeIn: handlers.onBargeIn,
          onError: (message, code) => handlers.onError?.(message, code),
          onListeningChange: (active) => {
            browserListening = active
            setListening()
          },
          onTranscript: (display) => {
            browserLive = display.trim()
            sync()
          },
        })
      : null

  const sileroGroq = createSileroGroqSttController({
    getStream: handlers.getStream,
    shouldRun: handlers.shouldRun,
    isAiSpeaking: handlers.isAiSpeaking,
    onBargeIn: handlers.onBargeIn,
    onError: (message) => handlers.onError?.(message),
    onListeningChange: (active) => {
      groqListening = active
      setListening()
    },
    onTranscribingChange: (active) => {
      if (active) groqInflight += 1
      else groqInflight = Math.max(0, groqInflight - 1)
      setTranscribing()
    },
    onTranscript: (display) => {
      groqCommitted = display.trim()
      groqPartial = ''
      browserLive = ''
      sync()
    },
  })

  const stopStreamRecorder = () => {
    streamListening = false
    try {
      streamRecorder?.stop()
    } catch {
      // ignore
    }
    streamRecorder = null
    setListening()
  }

  const startStreamRecorder = () => {
    if (browser || disposed) return
    const stream = handlers.getStream()
    const mime = pickRecorderMime()
    if (!stream || !mime || stream.getAudioTracks().length === 0) return

    stopStreamRecorder()
    streamSeq += 1
    const mySeq = streamSeq
    const audioOnly = new MediaStream(stream.getAudioTracks())
    const rec = new MediaRecorder(audioOnly, { mimeType: mime })
    streamRecorder = rec

    rec.ondataavailable = (ev) => {
      if (disposed || mySeq !== streamSeq || !ev.data.size) return
      if (ev.data.size < MIN_STREAM_BLOB_BYTES) return
      if (handlers.isAiSpeaking()) return
      groqInflight += 1
      setTranscribing()
      void transcribeInterviewChunk(ev.data)
        .then(({ text }) => {
          const cleaned = text.trim()
          if (!cleaned) return
          groqPartial = appendGroqDelta(groqPartial, cleaned)
          sync()
        })
        .catch((err) => {
          handlers.onError?.(
            err instanceof Error ? err.message : 'Live transcription failed.',
          )
        })
        .finally(() => {
          groqInflight = Math.max(0, groqInflight - 1)
          setTranscribing()
        })
    }

    rec.start(GROQ_STREAM_MS)
    streamListening = true
    setListening()
  }

  return {
    start: async () => {
      if (disposed || handlers.isAiSpeaking() || !handlers.shouldRun()) return
      browser?.start()
      await sileroGroq.start()
      startStreamRecorder()
    },
    stop: () => {
      browser?.stop()
      void sileroGroq.stop()
      stopStreamRecorder()
    },
    resetTranscript: (base = '') => {
      groqCommitted = base.trim()
      browserLive = ''
      groqPartial = ''
      browser?.resetTranscript(base)
      sileroGroq.resetTranscript(base)
      sync()
    },
    dispose: () => {
      disposed = true
      browser?.dispose()
      void sileroGroq.dispose()
      stopStreamRecorder()
      groqInflight = 0
      setTranscribing()
      handlers.onListeningChange?.(false)
    },
  }
}

export function liveInterviewSttHint(): string {
  if (isSpeechRecognitionSupported()) {
    return 'Live captions update instantly in your browser; Groq Whisper refines each phrase.'
  }
  return 'Live captions stream to Groq Whisper every ~450ms while you speak.'
}
