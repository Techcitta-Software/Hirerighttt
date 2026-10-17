/**
 * Groq OpenAI-compatible Whisper transcriptions (server-side only).
 */

const GROQ_TRANSCRIPTIONS_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'

export function groqWhisperConfigured() {
  return Boolean(String(process.env.GROQ_API_KEY || '').trim())
}

export function groqWhisperModel() {
  return String(process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo').trim()
}

export function groqWhisperLanguage() {
  return String(process.env.GROQ_WHISPER_LANGUAGE || 'en').trim()
}

/** @param {Buffer} audioBuffer */
export async function transcribeWithGroqWhisper(audioBuffer, options = {}) {
  const apiKey = String(process.env.GROQ_API_KEY || '').trim()
  if (!apiKey) {
    throw new Error('Groq Whisper is not configured on the server.')
  }
  if (!audioBuffer?.length) {
    throw new Error('Empty audio payload.')
  }

  const filename = String(options.filename || 'speech.wav')
  const mimeType = String(options.mimeType || 'audio/wav')
  const language = String(options.language || groqWhisperLanguage())
  const model = String(options.model || groqWhisperModel())

  const form = new FormData()
  form.append('file', new Blob([audioBuffer], { type: mimeType }), filename)
  form.append('model', model)
  if (language) form.append('language', language)
  form.append('response_format', 'json')
  form.append('temperature', '0')

  const res = await fetch(GROQ_TRANSCRIPTIONS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail =
      typeof data?.error?.message === 'string'
        ? data.error.message
        : typeof data?.error === 'string'
          ? data.error
          : `Groq transcription failed (${res.status})`
    throw new Error(detail)
  }

  return { text: String(data.text || '').trim(), model, language }
}
