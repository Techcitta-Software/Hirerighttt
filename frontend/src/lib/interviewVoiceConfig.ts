import flowJson from '../data/interviewInteractiveFlow.json'

/** Browser TTS settings for Ava — clear Indian English first, then fallbacks. */
export const INTERVIEW_VOICE = {
  agentName: flowJson.agent || 'Ava',
  language: flowJson.voice?.language || 'en-IN',
  fallbackLanguage: flowJson.voice?.fallbackLanguage || 'en-GB',
  /** Slightly slower than normal speech for clarity on interview questions. */
  rate: flowJson.voice?.rate ?? 0.88,
  pitch: flowJson.voice?.pitch ?? 1,
  /** Substrings that boost voice rank (Indian English / clear neural voices). */
  preferredNameHints: [
    'neerja',
    'heera',
    'ravi',
    'india',
    'indian',
    'english (india)',
    'en-in',
    'google uk english female',
    'google us english',
    'natural',
    'neural',
  ],
  avoidNameHints: ['compact', 'fast', 'whisper', 'child', 'boy'],
} as const

/** Normalize question text so browser TTS pauses and pronounces more clearly. */
export function prepareTextForInterviewSpeech(text: string): string {
  let t = String(text ?? '').trim()
  if (!t) return t
  t = t
    .replace(/\u2014/g, ', ')
    .replace(/\u2013/g, ', ')
    .replace(/…/g, '. ')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/\s+([,.?!;:])/g, '$1')
  t = t.replace(/([a-z])([A-Z])/g, '$1. $2')
  t = t.replace(/\?\s+/g, '? ')
  t = t.replace(/;\s*/g, '. ')
  return t.trim()
}
