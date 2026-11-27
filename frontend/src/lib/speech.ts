/** Browser speech helpers for the video AI interview. */

import { INTERVIEW_VOICE, prepareTextForInterviewSpeech } from './interviewVoiceConfig'
import { cancelNeuralSpeech, speakNeural } from './neuralVoice'

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/**
 * Ranks the device's voices for the case where the neural voice is unavailable. The goal is the voice most
 * listeners worldwide find easiest to understand: a natural/neural English voice with a neutral accent
 * (US, then UK, then Indian English) beats any compact or robotic one.
 */
export function voiceScore(v: Pick<SpeechSynthesisVoice, 'lang' | 'name' | 'localService'>): number {
  const lang = (v.lang || '').toLowerCase().replace('_', '-')
  const name = (v.name || '').toLowerCase()
  if (!lang.startsWith('en')) return -1000

  let score = 0
  if (lang === 'en-us') score += 60
  else if (lang === 'en-gb') score += 55
  else if (lang === 'en-in') score += 50
  else if (lang === 'en-au' || lang === 'en-ca') score += 40
  else score += 20

  // Natural-sounding voices are far clearer than the legacy desktop ones.
  if (/natural|neural|online|enhanced|premium/.test(name)) score += 80
  for (const hint of INTERVIEW_VOICE.preferredNameHints) {
    if (name.includes(hint)) score += 20
  }
  for (const bad of INTERVIEW_VOICE.avoidNameHints) {
    if (name.includes(bad)) score -= 80
  }
  // Voices known for robotic or novelty output.
  if (/espeak|zira|david|mark|hazel desktop|novelty|bad news|bubbles|cellos|trinoids|whisper|zarvox/.test(name)) score -= 60
  if (v.localService) score += 4
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

let speakGeneration = 0

export function cancelSpeech(): void {
  speakGeneration += 1
  cancelNeuralSpeech()
  if (!isSpeechSynthesisSupported()) return
  window.speechSynthesis.cancel()
}

export type SpeakOptions = {
  onStart?: () => void
  onEnd?: () => void
  onError?: () => void
  rate?: number
  pitch?: number
}

/**
 * Speak `text` in the interviewer's voice: the streamed neural voice when the server provides it, otherwise the
 * best voice on the device. Callbacks fire once per call, whichever voice ends up speaking.
 */
export function speakText(text: string, options?: SpeakOptions): void {
  const prepared = prepareTextForInterviewSpeech(text)
  if (!prepared) {
    options?.onEnd?.()
    return
  }
  cancelSpeech()
  const generation = speakGeneration

  void speakNeural(prepared, { onStart: options?.onStart, onEnd: options?.onEnd }).then((spoke) => {
    // Cancelled or replaced while waiting: someone else is speaking now, so say nothing.
    if (spoke || generation !== speakGeneration) return
    speakWithDeviceVoice(prepared, options)
  })
}

/** Device voices speak roughly this many words per second at rate 1. */
const DEVICE_WORDS_PER_SEC = 2.5
/** Extra time after the estimated end before the watchdog ends the speech itself. */
export const SPEECH_WATCHDOG_MARGIN_MS = 3_000
/** If the device voice has not started by then (no voices installed, blocked audio), stop waiting for it. */
export const SPEECH_START_TIMEOUT_MS = 3_000

/** How long `text` takes to say at `rate`, in ms (an estimate; used only as a safety net). */
export function estimatedSpeechMs(text: string, rate = 1): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return Math.round((words / (DEVICE_WORDS_PER_SEC * Math.max(0.5, rate || 1))) * 1000)
}

/**
 * Speaks with the device voice. A device without voices (locked-down PCs, headless browsers) may never fire
 * onstart / onend, which used to leave the room stuck on "Ava is speaking" with no answer window. A watchdog ends
 * the speech after the estimated duration plus a margin (or sooner if it never starts), so onEnd always fires once.
 */
function speakWithDeviceVoice(prepared: string, options?: SpeakOptions): void {
  if (!isSpeechSynthesisSupported()) {
    options?.onEnd?.()
    return
  }
  const generation = speakGeneration
  const synth = window.speechSynthesis
  synth.cancel()

  let settled = false
  let started = false
  let watchdog: number | undefined
  const rate = options?.rate ?? INTERVIEW_VOICE.rate
  const settle = (kind: 'end' | 'error') => {
    if (settled) return
    settled = true
    window.clearTimeout(watchdog)
    // Speech that was cancelled or replaced ends as "interrupted", like the browser's own error event.
    if (generation !== speakGeneration) kind = 'error'
    if (kind === 'error' && options?.onError) options.onError()
    else options?.onEnd?.()
  }
  const arm = (ms: number, onFire: () => void) => {
    window.clearTimeout(watchdog)
    watchdog = window.setTimeout(onFire, ms)
  }
  const endByWatchdog = () => {
    if (settled) return
    if (generation === speakGeneration) {
      try {
        synth.cancel()
      } catch {
        /* nothing to cancel */
      }
    }
    settle('end')
  }

  const run = () => {
    if (settled) return
    if (generation !== speakGeneration) {
      settle('error')
      return
    }
    const utterance = new SpeechSynthesisUtterance(prepared)
    const voice = pickVoice()
    if (voice) {
      utterance.voice = voice
      utterance.lang = voice.lang || INTERVIEW_VOICE.language
    } else {
      utterance.lang = INTERVIEW_VOICE.language
    }
    utterance.rate = rate
    utterance.pitch = options?.pitch ?? INTERVIEW_VOICE.pitch
    utterance.volume = 1
    const speechBudgetMs = estimatedSpeechMs(prepared, rate) + SPEECH_WATCHDOG_MARGIN_MS
    utterance.onstart = () => {
      if (started || settled) return
      started = true
      arm(speechBudgetMs, endByWatchdog)
      options?.onStart?.()
    }
    utterance.onend = () => settle('end')
    utterance.onerror = () => settle('error')
    arm(SPEECH_START_TIMEOUT_MS, () => {
      if (started || settled) return
      // Some voices speak without firing onstart: give them the rest of the estimated time, never cut them off.
      if (synth.speaking) {
        started = true
        arm(Math.max(0, speechBudgetMs - SPEECH_START_TIMEOUT_MS), endByWatchdog)
      } else {
        endByWatchdog()
      }
    })
    synth.speak(utterance)
  }

  if (synth.getVoices().length === 0) {
    const onVoices = () => {
      synth.removeEventListener('voiceschanged', onVoices)
      run()
    }
    synth.addEventListener('voiceschanged', onVoices)
    window.setTimeout(() => {
      synth.removeEventListener('voiceschanged', onVoices)
      if (!synth.speaking) run()
    }, 500)
    // Even if neither the event nor the timer leads to speech, the candidate still gets the answer window.
    arm(500 + SPEECH_START_TIMEOUT_MS, () => {
      if (!started) endByWatchdog()
    })
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

/** Lowercase, strip punctuation, collapse whitespace. */
function normalizedSpeechTokens(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return []
  return normalized.split(' ')
}

/** Tokens that are not NOISE_ONLY_RE fillers. */
export function speechContentWords(text: string): string[] {
  return normalizedSpeechTokens(text).filter((token) => token && !NOISE_ONLY_RE.test(token))
}

function isContiguousWordSlice(needle: string[], haystack: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false
  const last = haystack.length - needle.length
  for (let i = 0; i <= last; i += 1) {
    let match = true
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        match = false
        break
      }
    }
    if (match) return true
  }
  return false
}

export type SpokenSegmentGate = 'echo' | 'noise' | 'clear'

/**
 * While Ava is speaking, compare a transcript segment to the exact line passed to speakText.
 * Echo: either content-word sequence is a contiguous slice of the other.
 * Noise: empty, filler-only, or fewer than 2 content words.
 * Clear: 2+ content words and not an echo.
 */
export function classifySpokenSegment(segment: string, spokenLine: string): SpokenSegmentGate {
  const segmentWords = speechContentWords(segment)
  if (segmentWords.length < 2) return 'noise'
  const spokenWords = speechContentWords(spokenLine)
  if (
    spokenWords.length > 0 &&
    (isContiguousWordSlice(segmentWords, spokenWords) || isContiguousWordSlice(spokenWords, segmentWords))
  ) {
    return 'echo'
  }
  return 'clear'
}

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
