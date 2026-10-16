import { loadEnv } from '../loadEnv.mjs'
import { groqConfigured, groqWhisperModel, transcribeGroqWhisper } from '../groqWhisper.mjs'

loadEnv()

if (!groqConfigured()) {
  console.error('[ping-groq] Set GROQ_API_KEY in repo-root .env')
  process.exit(1)
}

/** Minimal silent WAV ~0.25s @ 16kHz mono PCM16 (sanity request shape). */
function tinyWav() {
  const sampleRate = 16000
  const numSamples = 4000
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

try {
  const text = await transcribeGroqWhisper(tinyWav())
  console.log('[ping-groq] OK model=', groqWhisperModel(), 'text=', JSON.stringify(text))
} catch (err) {
  console.error('[ping-groq] FAILED:', err instanceof Error ? err.message : err)
  process.exit(1)
}
