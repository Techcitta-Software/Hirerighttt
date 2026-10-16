import { apiFetch } from './api'
import { ensureApiSession } from './apiSession'

export type GroqTranscribeResult = {
  text: string
  provider?: string
  model?: string
}

/** Send a WAV utterance (Silero VAD segment) to the Node API → Groq Whisper. */
export async function transcribeInterviewChunk(audio: Blob): Promise<GroqTranscribeResult> {
  const authed = await ensureApiSession()
  if (!authed) {
    throw new Error('Sign in required for live transcription (API session).')
  }
  const buf = await audio.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...slice)
  }
  const audioBase64 = btoa(binary)

  const res = await apiFetch('/api/interview/transcribe', {
    method: 'POST',
    body: JSON.stringify({
      audioBase64,
      mimeType: audio.type || 'audio/wav',
    }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    text?: string
    error?: string
    provider?: string
    model?: string
  }
  if (!res.ok) {
    throw new Error(data.error || `Transcription failed (${res.status})`)
  }
  return {
    text: String(data.text || '').trim(),
    provider: data.provider,
    model: data.model,
  }
}

export async function fetchGroqSttAvailable(): Promise<boolean> {
  try {
    const res = await fetch('/api/health')
    const data = (await res.json()) as { groqStt?: boolean }
    return Boolean(data.groqStt)
  } catch {
    return false
  }
}
