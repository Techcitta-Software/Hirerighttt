import { describe, expect, it } from 'vitest'
import { shouldStickToWebSpeechFallback } from './interviewSttFallback'

describe('shouldStickToWebSpeechFallback', () => {
  it('does not stick on empty VAD segments', () => {
    expect(shouldStickToWebSpeechFallback('No speech detected in that segment.')).toBe(false)
  })

  it('sticks on load or worker failures', () => {
    expect(shouldStickToWebSpeechFallback('Voice transcription failed.')).toBe(true)
    expect(shouldStickToWebSpeechFallback('Local speech model is still loading.')).toBe(true)
  })
})
