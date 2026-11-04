/** Browser speech helpers for the video AI interview. */

import { INTERVIEW_VOICE, prepareTextForInterviewSpeech } from './interviewVoiceConfig'

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

function voiceScore(v: SpeechSynthesisVoice): number {
  const lang = (v.lang || '').toLowerCase()
  const name = (v.name || '').toLowerCase()
  let score = 0

  if (lang === INTERVIEW_VOICE.language.toLowerCase() || lang.replace('_', '-') === 'en-in') {
    score += 120
  } else if (lang.startsWith('en-in')) {
    score += 90
  } else if (lang.startsWith('en-gb')) {
    score += 40
  } else if (lang.startsWith('en-us')) {
    score += 35
  } else if (lang.startsWith('en')) {
    score += 20
  }

  for (const hint of INTERVIEW_VOICE.preferredNameHints) {
    if (name.includes(hint)) score += 35
  }
  for (const bad of INTERVIEW_VOICE.avoidNameHints) {
    if (name.includes(bad)) score -= 80
  }
  if (v.localService) score += 8

  return score
}

function pickVoice(): SpeechSynthesisVoice | null {
  if (!isSpeechSynthesisSupported()) return null
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null

  const ranked = [...voices].sort((a, b) => voiceScore(b) - voiceScore(a))
  const best = ranked[0]
  if (best && voiceScore(best) > 0) return best

  return (
    voices.find((v) => v.lang.toLowerCase().startsWith('en-in')) ??
    voices.find((v) => v.lang.toLowerCase().startsWith('en-gb')) ??
    voices.find((v) => v.lang.toLowerCase().startsWith('en')) ??
    voices[0] ??
    null
  )
}

export function cancelSpeech(): void {
  if (!isSpeechSynthesisSupported()) return
  window.speechSynthesis.cancel()
}

export function speakText(
  text: string,
  options?: {
    onStart?: () => void
    onEnd?: () => void
    onError?: () => void
    rate?: number
    pitch?: number
  },
): void {
  const prepared = prepareTextForInterviewSpeech(text)
  if (!isSpeechSynthesisSupported() || !prepared) {
    options?.onEnd?.()
    return
  }

  cancelSpeech()

  const run = () => {
    const utterance = new SpeechSynthesisUtterance(prepared)
    const voice = pickVoice()
    if (voice) {
      utterance.voice = voice
      utterance.lang = voice.lang || INTERVIEW_VOICE.language
    } else {
      utterance.lang = INTERVIEW_VOICE.language
    }
    utterance.rate = options?.rate ?? INTERVIEW_VOICE.rate
    utterance.pitch = options?.pitch ?? INTERVIEW_VOICE.pitch
    utterance.volume = 1
    utterance.onstart = () => options?.onStart?.()
    utterance.onend = () => options?.onEnd?.()
    utterance.onerror = () => options?.onError?.()
    window.speechSynthesis.speak(utterance)
  }

  if (window.speechSynthesis.getVoices().length === 0) {
    const onVoices = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', onVoices)
      run()
    }
    window.speechSynthesis.addEventListener('voiceschanged', onVoices)
    window.setTimeout(() => {
      window.speechSynthesis.removeEventListener('voiceschanged', onVoices)
      if (!window.speechSynthesis.speaking) run()
    }, 500)
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

const INTERVIEW_LANG_KEY = 'hireright.stt.lang'
/** Prefer Indian English for STT when rotating locales. */
const INTERVIEW_LANG_CHAIN = ['en-IN', 'en-US', 'en-GB'] as const

export function getInterviewRecognitionLang(): string {
  try {
    const saved = sessionStorage.getItem(INTERVIEW_LANG_KEY)
    if (saved) return saved
  } catch {
    // ignore
  }
  return INTERVIEW_VOICE.language || INTERVIEW_LANG_CHAIN[0]
}

export function rotateInterviewRecognitionLang(): string {
  const current = getInterviewRecognitionLang()
  const idx = INTERVIEW_LANG_CHAIN.indexOf(current as (typeof INTERVIEW_LANG_CHAIN)[number])
  const next = INTERVIEW_LANG_CHAIN[(idx >= 0 ? idx + 1 : 0) % INTERVIEW_LANG_CHAIN.length]
  try {
    sessionStorage.setItem(INTERVIEW_LANG_KEY, next)
  } catch {
    // ignore
  }
  return next
}

export function describeRecognitionError(code: string): string {
  const messages: Record<string, string> = {
    'not-allowed':
      'Microphone access was blocked. Allow the mic in your browser settings and reload.',
    'service-not-allowed': 'Speech recognition is not allowed on this page.',
    'audio-capture': 'No microphone detected. Check your device and try again.',
    network: 'Network error during speech recognition. Retrying…',
    'language-not-supported': 'Trying a different English locale for voice captions…',
  }
  return messages[code] || `Speech recognition error (${code}).`
}

export function shouldCaptureSpeechDuringTts(merged: RecognitionMerge): boolean {
  if (merged.bargeIn) return true
  const text = (merged.interim || merged.committed).trim()
  if (!text || NOISE_ONLY_RE.test(text)) return false
  const words = text.split(/\s+/).filter(Boolean)
  return words.length >= 2 || text.length >= 10
}

export function configureInterviewRecognition(recognition: SpeechRecognition): void {
  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = getInterviewRecognitionLang()
}
