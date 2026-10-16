/**
 * Groq OpenAI-compatible Whisper transcription (server-side only — key never sent to browser).
 */

const GROQ_TRANSCRIPTIONS_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'

export function groqConfigured() {
  return Boolean(String(process.env.GROQ_API_KEY || '').trim())
}

export function groqWhisperModel() {
  return String(process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo').trim()
}

/**
 * @param {Buffer} wavBuffer — WAV PCM mono 16 kHz (Silero VAD output)
 * @param {{ language?: string }} [opts]
 * @returns {Promise<string>}
 */
export async function transcribeGroqWhisper(audioBuffer, opts = {}) {
  const apiKey = String(process.env.GROQ_API_KEY || '').trim()
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not configured')
  }
  const model = groqWhisperModel()
  const language = opts.language || process.env.GROQ_WHISPER_LANGUAGE || 'en'

  const mime = opts.mimeType || 'audio/wav'
  const ext = mime.includes('webm') ? 'chunk.webm' : mime.includes('ogg') ? 'chunk.ogg' : 'utterance.wav'
  const form = new FormData()
  form.append('file', new Blob([audioBuffer], { type: mime }), ext)
  form.append('model', model)
  form.append('language', language)
  form.append('response_format', 'json')
  form.append('temperature', '0')

  const res = await fetch(GROQ_TRANSCRIPTIONS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })

  const raw = await res.text()
  let data = {}
  try {
    data = raw ? JSON.parse(raw) : {}
  } catch {
    data = { error: raw.slice(0, 400) }
  }

  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.error ||
      (typeof data.message === 'string' ? data.message : null) ||
      `Groq transcription failed (${res.status})`
    throw new Error(msg)
  }

  return String(data.text || '').trim()
}
