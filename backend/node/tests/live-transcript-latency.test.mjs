import test from 'node:test'
import assert from 'node:assert/strict'
import { loadEnv } from '../loadEnv.mjs'
import { groqConfigured, transcribeGroqWhisper } from '../groqWhisper.mjs'

loadEnv()

/** ~0.35s silence @ 16kHz mono PCM16 — enough for Groq smoke test. */
function shortWav() {
  const sampleRate = 16000
  const numSamples = 5600
  const dataSize = numSamples * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  return buf
}

test('Groq transcription round-trip under 3s (live caption backend path)', async (t) => {
  if (!groqConfigured()) {
    t.skip('GROQ_API_KEY not set')
    return
  }
  const started = performance.now()
  const text = await transcribeGroqWhisper(shortWav())
  const elapsed = performance.now() - started
  assert.ok(typeof text === 'string')
  assert.ok(elapsed < 3000, `expected Groq < 3s, got ${elapsed.toFixed(0)}ms`)
})
