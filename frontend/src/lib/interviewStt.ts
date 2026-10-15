/**
 * Reliable Web Speech API restart (Chrome requires a fresh instance after onend).
 */

import {
  configureInterviewRecognition,
  describeRecognitionError,
  getInterviewRecognitionLang,
  getSpeechRecognition,
  isSpeechRecognitionSupported,
  mergeRecognitionResults,
  rotateInterviewRecognitionLang,
  shouldCaptureSpeechDuringTts,
  type RecognitionMerge,
} from './speech'

export type InterviewSttHandlers = {
  onTranscript: (display: string, merged: RecognitionMerge) => void
  onBargeIn?: () => void
  onError?: (message: string, code: string) => void
  onListeningChange?: (active: boolean) => void
  shouldRun: () => boolean
  isAiSpeaking: () => boolean
}

export type InterviewSttController = {
  start: (options?: { duringTts?: boolean }) => void
  stop: () => void
  resetTranscript: (base?: string) => void
  dispose: () => void
}

export function createInterviewSttController(
  handlers: InterviewSttHandlers,
): InterviewSttController {
  if (!isSpeechRecognitionSupported()) {
    return {
      start: () => undefined,
      stop: () => undefined,
      resetTranscript: () => undefined,
      dispose: () => undefined,
    }
  }

  let sessionId = 0
  let recognition: SpeechRecognition | null = null
  let committed = ''
  let restartTimer: number | null = null

  const clearRestart = () => {
    if (restartTimer != null) {
      window.clearTimeout(restartTimer)
      restartTimer = null
    }
  }

  const scheduleRestart = (delayMs = 150) => {
    clearRestart()
    restartTimer = window.setTimeout(() => {
      restartTimer = null
      if (handlers.shouldRun()) start({ duringTts: true })
    }, delayMs)
  }

  const stop = () => {
    sessionId += 1
    clearRestart()
    try {
      recognition?.stop()
    } catch {
      // ignore
    }
    try {
      ;(recognition as SpeechRecognition & { abort?: () => void })?.abort?.()
    } catch {
      // ignore
    }
    recognition = null
    handlers.onListeningChange?.(false)
  }

  const start = (options?: { duringTts?: boolean }) => {
    if (!handlers.shouldRun()) return
    if (handlers.isAiSpeaking() && !options?.duringTts) return

    const mySession = ++sessionId
    clearRestart()
    try {
      recognition?.stop()
    } catch {
      // ignore
    }

    const rec = getSpeechRecognition()
    if (!rec) return
    recognition = rec
    configureInterviewRecognition(rec)

    rec.onresult = (event: SpeechRecognitionEvent) => {
      if (mySession !== sessionId) return
      const merged = mergeRecognitionResults(event, committed)
      committed = merged.committed
      const display = merged.interim
        ? `${merged.committed} ${merged.interim}`.trim()
        : merged.committed.trim()

      if (handlers.isAiSpeaking()) {
        if (display) handlers.onTranscript(display, merged)
        if (shouldCaptureSpeechDuringTts(merged)) handlers.onBargeIn?.()
        return
      }

      if (display) handlers.onTranscript(display, merged)
    }

    rec.onerror = (event: Event) => {
      if (mySession !== sessionId) return
      const code = (event as SpeechRecognitionErrorEvent).error || 'unknown'
      if (code === 'language-not-supported' || code === 'network') {
        rotateInterviewRecognitionLang()
      }
      if (code !== 'no-speech' && code !== 'aborted') {
        handlers.onError?.(describeRecognitionError(code), code)
      }
      handlers.onListeningChange?.(false)
      if (code === 'no-speech' || code === 'aborted') {
        scheduleRestart(200)
      } else if (code === 'language-not-supported' || code === 'network') {
        scheduleRestart(400)
      }
    }

    rec.onend = () => {
      if (mySession !== sessionId) return
      handlers.onListeningChange?.(false)
      if (handlers.shouldRun()) scheduleRestart(120)
    }

    try {
      rec.start()
      handlers.onListeningChange?.(true)
    } catch {
      handlers.onListeningChange?.(false)
      scheduleRestart(300)
    }
  }

  const resetTranscript = (base = '') => {
    committed = base.trim()
  }

  const dispose = () => stop()

  return {
    start,
    stop,
    resetTranscript,
    dispose,
  }
}

export function interviewSttHint(): string {
  if (!isSpeechRecognitionSupported()) {
    return 'Use Chrome or Edge for voice captions, or type your answers.'
  }
  return `Voice captions (${getInterviewRecognitionLang()}) — speak after the mic icon shows Listening.`
}
