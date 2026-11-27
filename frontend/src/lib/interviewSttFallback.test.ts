import { describe, expect, it } from 'vitest'
import { shouldStickToWebSpeechFallback } from './interviewSttFallback'
import { TRANSCRIBE_TIMEOUT_MESSAGE, withTimeout } from './moonshineStt'

describe('shouldStickToWebSpeechFallback', () => {
  it('does not stick on empty VAD segments', () => {
    expect(shouldStickToWebSpeechFallback('No speech detected in that segment.')).toBe(false)
  })

  it('sticks on load or worker failures', () => {
    expect(shouldStickToWebSpeechFallback('Voice transcription failed.')).toBe(true)
    expect(shouldStickToWebSpeechFallback(TRANSCRIBE_TIMEOUT_MESSAGE)).toBe(true)
    expect(shouldStickToWebSpeechFallback('Local speech model is still loading.')).toBe(true)
  })
})

describe('transcription timeout', () => {
  it('rejects a transcription that never returns', async () => {
    await expect(withTimeout(new Promise(() => {}), 20, TRANSCRIBE_TIMEOUT_MESSAGE)).rejects.toThrow(
      TRANSCRIBE_TIMEOUT_MESSAGE,
    )
  })
})
