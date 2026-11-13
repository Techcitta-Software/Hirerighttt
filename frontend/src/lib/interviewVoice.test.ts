import { describe, expect, it, vi } from 'vitest'
import { pcm16ToFloat32 } from './neuralVoice'
import { voiceScore } from './speech'

const v = (name: string, lang: string, localService = true) => ({ name, lang, localService })

describe('device voice ranking (used when the neural voice is unavailable)', () => {
  it('prefers a natural English voice over a legacy desktop one', () => {
    const natural = voiceScore(v('Microsoft Aria Online (Natural) - English (United States)', 'en-US', false))
    const legacy = voiceScore(v('Microsoft David Desktop - English (United States)', 'en-US'))
    expect(natural).toBeGreaterThan(legacy)
  })

  it('never picks a non-English voice', () => {
    expect(voiceScore(v('Microsoft Hemant', 'hi-IN'))).toBeLessThan(0)
    expect(voiceScore(v('Google français', 'fr-FR'))).toBeLessThan(0)
  })

  it('ranks neutral accents first: US, then UK, then Indian English, at equal quality', () => {
    const us = voiceScore(v('Voice Natural', 'en-US'))
    const gb = voiceScore(v('Voice Natural', 'en-GB'))
    const inn = voiceScore(v('Voice Natural', 'en-IN'))
    expect(us).toBeGreaterThan(gb)
    expect(gb).toBeGreaterThan(inn)
  })

  it('a natural Indian English voice still beats a plain US one', () => {
    expect(voiceScore(v('Microsoft Neerja Online (Natural) - English (India)', 'en-IN', false))).toBeGreaterThan(
      voiceScore(v('Basic US voice', 'en-US')),
    )
  })

  it('avoids compact and novelty voices', () => {
    expect(voiceScore(v('Fred', 'en-US'))).toBeGreaterThan(voiceScore(v('Zarvox', 'en-US')))
    expect(voiceScore(v('Voice compact', 'en-US'))).toBeLessThan(voiceScore(v('Voice', 'en-US')))
  })
})

describe('pcm16ToFloat32', () => {
  it('decodes little-endian 16-bit samples to floats', () => {
    const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x40, 0x00, 0xc0, 0xff, 0x7f])
    const out = pcm16ToFloat32(bytes)
    expect(Array.from(out).map((n) => Math.round(n * 1000) / 1000)).toEqual([0, 0.5, -0.5, 1])
  })

  it('handles a view into a larger buffer', () => {
    const big = new Uint8Array([9, 9, 0x00, 0x40, 9])
    expect(pcm16ToFloat32(big.subarray(2, 4))[0]).toBeCloseTo(0.5, 3)
  })
})

describe('speakText fallback', () => {
  it('uses the device voice when the server voice cannot start', async () => {
    vi.resetModules()
    vi.doMock('./neuralVoice', () => ({
      speakNeural: vi.fn(async () => false),
      cancelNeuralSpeech: vi.fn(),
      pcm16ToFloat32: vi.fn(),
    }))
    const spoken: string[] = []
    class Utter {
      text: string
      voice: unknown
      lang = ''
      rate = 1
      pitch = 1
      volume = 1
      onstart: (() => void) | null = null
      onend: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(t: string) {
        this.text = t
      }
    }
    const synth = {
      getVoices: () => [{ name: 'Microsoft Aria Online (Natural)', lang: 'en-US', localService: false }],
      cancel: vi.fn(),
      speak: (u: Utter) => {
        spoken.push(u.text)
        u.onend?.()
      },
      speaking: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    vi.stubGlobal('window', { speechSynthesis: synth, setTimeout, clearTimeout })
    vi.stubGlobal('SpeechSynthesisUtterance', Utter)
    const { speakText } = await import('./speech')
    const ended = new Promise<void>((resolve) => speakText('Tell me about yourself.', { onEnd: resolve }))
    await ended
    expect(spoken).toEqual(['Tell me about yourself.'])
    vi.unstubAllGlobals()
    vi.doUnmock('./neuralVoice')
  })
})
