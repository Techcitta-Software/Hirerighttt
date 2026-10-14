/** Browser speech helpers for the video AI interview. */

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

function pickVoice(): SpeechSynthesisVoice | null {
  if (!isSpeechSynthesisSupported()) return null
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null

  const preferred = voices.find(
    (v) =>
      /en(-|_)?(US|GB|IN|AU)?/i.test(v.lang) &&
      /google|natural|neural|samantha|jenny|aria|female/i.test(v.name),
  )
  if (preferred) return preferred

  return (
    voices.find((v) => v.lang.toLowerCase().startsWith('en')) ?? voices[0] ?? null
  )
}

let _activeUtterance: SpeechSynthesisUtterance | null = null
let watchdogTimer: number | null = null
let keepAliveInterval: number | null = null

export function getActiveUtterance(): SpeechSynthesisUtterance | null {
  return _activeUtterance
}

export function cancelSpeech(): void {
  if (typeof window === 'undefined' || !isSpeechSynthesisSupported()) return
  if (watchdogTimer !== null) {
    window.clearTimeout(watchdogTimer)
    watchdogTimer = null
  }
  if (keepAliveInterval !== null) {
    window.clearInterval(keepAliveInterval)
    keepAliveInterval = null
  }
  _activeUtterance = null
  try {
    window.speechSynthesis.cancel()
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume()
    }
  } catch {
    // ignore
  }
}

export function speakText(
  text: string,
  options?: {
    onStart?: () => void
    onEnd?: () => void
    onError?: () => void
  },
): void {
  if (!isSpeechSynthesisSupported() || !text.trim()) {
    options?.onEnd?.()
    return
  }

  cancelSpeech()

  let completed = false
  const finish = (cb?: () => void) => {
    if (completed) return
    completed = true
    if (watchdogTimer !== null) {
      window.clearTimeout(watchdogTimer)
      watchdogTimer = null
    }
    if (keepAliveInterval !== null) {
      window.clearInterval(keepAliveInterval)
      keepAliveInterval = null
    }
    _activeUtterance = null
    cb?.()
  }

  const run = () => {
    if (completed) return
    try {
      const utterance = new SpeechSynthesisUtterance(text.trim())
      _activeUtterance = utterance
      const voice = pickVoice()
      if (voice) utterance.voice = voice
      utterance.rate = 1.02
      utterance.pitch = 1
      utterance.volume = 1
      utterance.onstart = () => {
        if (!completed) options?.onStart?.()
      }
      utterance.onend = () => {
        finish(options?.onEnd)
      }
      utterance.onerror = () => {
        finish(options?.onEnd || options?.onError)
      }

      // Chromium bug workaround: keep synthesis alive if utterance > 8s
      keepAliveInterval = window.setInterval(() => {
        if (!window.speechSynthesis.speaking) {
          if (keepAliveInterval !== null) {
            window.clearInterval(keepAliveInterval)
            keepAliveInterval = null
          }
        } else {
          try {
            window.speechSynthesis.pause()
            window.speechSynthesis.resume()
          } catch {}
        }
      }, 8000)

      // Safety watchdog: estimated duration based on word count
      const words = text.trim().split(/\s+/).length
      const estimatedMs = Math.max(6000, Math.round((words / 2.0) * 1000) + 4000)
      watchdogTimer = window.setTimeout(() => {
        if (!completed) {
          try {
            window.speechSynthesis.cancel()
          } catch {}
          finish(options?.onEnd)
        }
      }, estimatedMs)

      window.speechSynthesis.speak(utterance)
    } catch {
      finish(options?.onEnd)
    }
  }

  if (window.speechSynthesis.getVoices().length === 0) {
    let fired = false
    const onVoices = () => {
      if (fired) return
      fired = true
      window.speechSynthesis.removeEventListener('voiceschanged', onVoices)
      run()
    }
    window.speechSynthesis.addEventListener('voiceschanged', onVoices)
    // Fallback if voiceschanged never fires
    window.setTimeout(() => {
      if (!fired) {
        fired = true
        window.speechSynthesis.removeEventListener('voiceschanged', onVoices)
        run()
      }
    }, 350)
    return
  }

  run()
}

export function getSpeechRecognition(): SpeechRecognition | null {
  if (!isSpeechRecognitionSupported()) return null
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
  return Ctor ? new Ctor() : null
}

/** Mic constraints for interview — echo/noise reduction for clearer STT. */
export function interviewAudioConstraints(): MediaTrackConstraints {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  }
}

const NOISE_ONLY_RE =
  /^(uh+|um+|hmm+|hm+|ah+|oh+|mm+|mhm+|la+|ha+|the|a|an|and|or|so|well)\.?$/i

/** Final result strong enough to interrupt Ava (ignore fan hum / one-word noise). */
export function shouldBargeInOnFinal(result: SpeechRecognitionResult): boolean {
  if (!result.isFinal) return false
  const text = (result[0]?.transcript || '').trim()
  if (!text || NOISE_ONLY_RE.test(text)) return false
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length < 2 && text.length < 8) return false
  const conf = result[0]?.confidence
  if (typeof conf === 'number' && conf > 0 && conf < 0.42) return false
  return true
}

export type RecognitionMerge = {
  committed: string
  interim: string
  bargeIn: boolean
  hadFinal: boolean
}

/** Incremental Web Speech merge (avoids duplicating prior results). */
export function mergeRecognitionResults(
  event: SpeechRecognitionEvent,
  priorCommitted: string,
): RecognitionMerge {
  let committed = priorCommitted
  let interim = ''
  let bargeIn = false
  let hadFinal = false

  for (let i = event.resultIndex; i < event.results.length; i += 1) {
    const result = event.results[i]
    const chunk = (result[0]?.transcript || '').trim()
    if (!chunk) continue

    if (result.isFinal) {
      hadFinal = true
      committed = committed ? `${committed} ${chunk}` : chunk
      if (shouldBargeInOnFinal(result)) bargeIn = true
    } else {
      interim = interim ? `${interim} ${chunk}` : chunk
    }
  }

  return { committed, interim, bargeIn, hadFinal }
}

export function configureInterviewRecognition(recognition: SpeechRecognition): void {
  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = navigator.language?.toLowerCase().startsWith('en')
    ? navigator.language
    : 'en-US'
}
