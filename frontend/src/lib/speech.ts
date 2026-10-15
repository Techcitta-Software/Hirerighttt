/** Browser speech helpers for the video AI interview (Jessica / clear en-IN friendly). */

import { defaultInterviewSpeechRate } from './interviewInteractive'

const ELEVENLABS_KEY =
  typeof import.meta !== 'undefined'
    ? import.meta.env.VITE_ELEVENLABS_API_KEY || ''
    : ''
const ELEVENLABS_VOICE_ID =
  typeof import.meta !== 'undefined'
    ? import.meta.env.VITE_ELEVENLABS_VOICE_ID || 'cgSgspJ2msm6clMCkdW9'
    : 'cgSgspJ2msm6clMCkdW9'

let interviewSpeechRate = defaultInterviewSpeechRate()
let activeAudio: HTMLAudioElement | null = null

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** Chrome/Edge STT is most reliable on en-US (works well for Indian English speech too). */
const RECOGNITION_LANG_CANDIDATES = ['en-US', 'en-IN', 'en-GB'] as const
let recognitionLangIndex = 0

export function getInterviewRecognitionLang(): string {
  return RECOGNITION_LANG_CANDIDATES[recognitionLangIndex] ?? 'en-US'
}

export function rotateInterviewRecognitionLang(): string {
  recognitionLangIndex =
    (recognitionLangIndex + 1) % RECOGNITION_LANG_CANDIDATES.length
  return getInterviewRecognitionLang()
}

export function resetInterviewRecognitionLang(): void {
  recognitionLangIndex = 0
}

export function setInterviewSpeechRate(rate: number): void {
  interviewSpeechRate = Math.min(1.15, Math.max(0.75, rate))
}

export function getInterviewSpeechRate(): number {
  return interviewSpeechRate
}

function scoreVoice(v: SpeechSynthesisVoice): number {
  const name = v.name.toLowerCase()
  const lang = v.lang.toLowerCase()
  let score = 0
  if (/jessica/i.test(name)) score += 100
  if (lang.startsWith('en-in')) score += 45
  if (lang.startsWith('en-gb')) score += 28
  if (/google.*english.*india|india.*english/i.test(name)) score += 40
  if (/natural|neural|online/i.test(name)) score += 12
  if (/female|zira|jenny|sonia|priya|neerja/i.test(name)) score += 8
  if (lang.startsWith('en-us')) score += 5
  return score
}

function pickVoice(): SpeechSynthesisVoice | null {
  if (!isSpeechSynthesisSupported()) return null
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null

  const ranked = [...voices].sort((a, b) => scoreVoice(b) - scoreVoice(a))
  const best = ranked[0]
  if (best && scoreVoice(best) >= 8) return best

  return (
    voices.find((v) => /jessica/i.test(v.name)) ??
    voices.find((v) => v.lang.toLowerCase().startsWith('en-in')) ??
    voices.find((v) => v.lang.toLowerCase().startsWith('en-gb')) ??
    voices.find((v) => v.lang.toLowerCase().startsWith('en')) ??
    voices[0] ??
    null
  )
}

export function getSelectedInterviewVoiceName(): string {
  const v = pickVoice()
  return v?.name || 'Jessica (system default)'
}

export function cancelSpeech(): void {
  if (activeAudio) {
    activeAudio.pause()
    activeAudio.src = ''
    activeAudio = null
  }
  if (!isSpeechSynthesisSupported()) return
  window.speechSynthesis.cancel()
}

async function speakWithElevenLabs(
  text: string,
  options?: {
    onStart?: () => void
    onEnd?: () => void
    onError?: () => void
  },
): Promise<boolean> {
  if (!ELEVENLABS_KEY || typeof window === 'undefined') return false
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': ELEVENLABS_KEY,
        },
        body: JSON.stringify({
          text: text.trim(),
          model_id: 'eleven_turbo_v2_5',
          voice_settings: {
            stability: 0.45,
            similarity_boost: 0.78,
            style: 0.15,
            use_speaker_boost: true,
          },
        }),
      },
    )
    if (!res.ok) return false
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    activeAudio = audio
    options?.onStart?.()
    await audio.play()
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => {
        URL.revokeObjectURL(url)
        activeAudio = null
        resolve()
      }
      audio.onerror = () => {
        URL.revokeObjectURL(url)
        activeAudio = null
        reject(new Error('audio error'))
      }
    })
    options?.onEnd?.()
    return true
  } catch {
    options?.onError?.()
    return false
  }
}

function speakWithBrowser(
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

  const run = () => {
    const utterance = new SpeechSynthesisUtterance(text.trim())
    const voice = pickVoice()
    if (voice) {
      utterance.voice = voice
      utterance.lang = voice.lang || getInterviewRecognitionLang()
    } else {
      utterance.lang = getInterviewRecognitionLang()
    }
    utterance.rate = interviewSpeechRate
    utterance.pitch = 1
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
      if (!window.speechSynthesis.speaking && !activeAudio) run()
    }, 400)
    return
  }

  run()
}

export function speakText(
  text: string,
  options?: {
    onStart?: () => void
    onEnd?: () => void
    onError?: () => void
  },
): void {
  if (!text.trim()) {
    options?.onEnd?.()
    return
  }

  cancelSpeech()

  if (ELEVENLABS_KEY) {
    void (async () => {
      const ok = await speakWithElevenLabs(text, options)
      if (!ok) speakWithBrowser(text, options)
    })()
    return
  }

  speakWithBrowser(text, options)
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

const WARM_BARGE_SINGLE_RE =
  /^(yes|yeah|yep|yup|ok|okay|no|nope|hi|hello|hey|good|fine|great|haan|han|ready|stop|wait|thanks|thank you)$/i

/** Final result strong enough to interrupt Ava (ignore fan hum / one-word noise). */
export function shouldBargeInOnFinal(result: SpeechRecognitionResult): boolean {
  if (!result.isFinal) return false
  const text = (result[0]?.transcript || '').trim()
  if (!text || NOISE_ONLY_RE.test(text)) return false
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length < 2 && text.length < 8 && !WARM_BARGE_SINGLE_RE.test(text)) {
    return false
  }
  const conf = result[0]?.confidence
  if (typeof conf === 'number' && conf > 0 && conf < 0.35) return false
  return true
}

export type RecognitionMerge = {
  committed: string
  interim: string
  bargeIn: boolean
  hadFinal: boolean
}

export function shouldCaptureSpeechDuringTts(merged: RecognitionMerge): boolean {
  if (merged.bargeIn) return true
  if (!merged.hadFinal) return false
  const text = merged.committed.trim()
  if (text.length >= 3) return true
  return WARM_BARGE_SINGLE_RE.test(text)
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
  recognition.lang = getInterviewRecognitionLang()
  try {
    ;(recognition as SpeechRecognition & { maxAlternatives?: number }).maxAlternatives = 3
  } catch {
    // not supported in all browsers
  }
}

export function describeRecognitionError(code: string): string {
  switch (code) {
    case 'not-allowed':
      return 'Microphone blocked — allow mic access for this site, then click Listen again.'
    case 'service-not-allowed':
      return 'Speech service unavailable — try Chrome or Edge, or use the keyboard.'
    case 'language-not-supported':
      return 'Switching speech language — speak again in English.'
    case 'network':
      return 'Network issue with speech recognition — check connection or use keyboard.'
    case 'no-speech':
      return 'No speech detected — speak closer to the mic.'
    case 'aborted':
      return 'Listening paused — will restart automatically.'
    default:
      return 'Voice input hiccup — still listening; you can type if needed.'
  }
}
