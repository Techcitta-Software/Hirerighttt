/**
 * Gemini HTTP client — supports AI Studio auth keys (AQ.*) and legacy standard keys (AIza*).
 *
 * Auth keys must use the native Generative Language API with x-goog-api-key only.
 * OpenAI-compatible /chat/completions must not send Bearer + x-goog-api-key together for AQ. keys.
 */

export const GEMINI_NATIVE_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export function resolveGeminiApiKey() {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.LLM_API_KEY ||
    ''
  ).trim()
}

/** Google AI Studio authorization keys (2026+) */
export function isGeminiAuthKey(apiKey) {
  return String(apiKey || '').trim().startsWith('AQ.')
}

/** Legacy unrestricted / restricted standard keys */
export function isGeminiStandardKey(apiKey) {
  return String(apiKey || '').trim().startsWith('AIza')
}

export function geminiKeyFormatWarning() {
  const key = process.env.GEMINI_API_KEY?.trim()
  if (!key) return null
  if (isGeminiAuthKey(key) || isGeminiStandardKey(key)) return null
  return (
    'GEMINI_API_KEY format not recognized (expected AIza… standard or AQ.… auth key from AI Studio). ' +
    'Create one at https://aistudio.google.com/apikey'
  )
}

export function geminiOpenAiBaseUrl() {
  const custom = process.env.OPENAI_BASE_URL?.replace(/\/$/, '')
  if (custom) return custom
  return 'https://generativelanguage.googleapis.com/v1beta/openai'
}

/** Headers for Gemini OpenAI-compatible chat/completions */
export function geminiOpenAiHeaders(apiKey) {
  const key = String(apiKey || '').trim()
  const headers = { 'Content-Type': 'application/json' }
  if (isGeminiAuthKey(key)) {
    headers['x-goog-api-key'] = key
    return headers
  }
  headers['x-goog-api-key'] = key
  headers.Authorization = `Bearer ${key}`
  return headers
}

/**
 * @param {{ apiKey: string, model: string, system?: string, user: string, temperature?: number, maxTokens?: number }} opts
 */
export async function geminiNativeGenerateContent({
  apiKey,
  model,
  system,
  user,
  temperature = 0.3,
  maxTokens,
}) {
  const url = `${GEMINI_NATIVE_BASE}/models/${encodeURIComponent(model)}:generateContent`
  /** @type {Record<string, unknown>} */
  const body = {
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature },
  }
  if (system?.trim()) {
    body.systemInstruction = { parts: [{ text: system.trim() }] }
  }
  if (typeof maxTokens === 'number' && maxTokens > 0) {
    body.generationConfig.maxOutputTokens = maxTokens
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey.trim(),
    },
    body: JSON.stringify(body),
  })

  const raw = await res.text()
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    data = { error: { message: raw.slice(0, 400) } }
  }

  if (!res.ok) {
    const msg = data.error?.message || raw.slice(0, 400)
    return { ok: false, status: res.status, error: msg, text: '' }
  }

  const parts = data.candidates?.[0]?.content?.parts || []
  const text = parts.map((p) => p.text || '').join('')
  const usage = data.usageMetadata || {}
  return {
    ok: true,
    status: res.status,
    text,
    tokenUsage: {
      promptTokens: usage.promptTokenCount || 0,
      completionTokens: usage.candidatesTokenCount || usage.totalTokenCount || 0,
      totalTokens: usage.totalTokenCount || 0,
    },
  }
}

/**
 * @param {{ apiKey: string, model: string, system?: string, user: string, temperature?: number, maxTokens?: number }} opts
 */
export async function geminiOpenAiChatCompletions(opts) {
  const { apiKey, model, system, user, temperature = 0.3, maxTokens } = opts
  const base = geminiOpenAiBaseUrl()
  /** @type {Record<string, unknown>} */
  const body = {
    model,
    temperature,
    messages: [
      ...(system?.trim() ? [{ role: 'system', content: system.trim() }] : []),
      { role: 'user', content: user },
    ],
  }
  if (typeof maxTokens === 'number' && maxTokens > 0) {
    body.max_tokens = maxTokens
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: geminiOpenAiHeaders(apiKey),
    body: JSON.stringify(body),
  })

  const raw = await res.text()
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    data = { error: { message: raw.slice(0, 400) } }
  }

  if (!res.ok) {
    const msg = data.error?.message || raw.slice(0, 400)
    return { ok: false, status: res.status, error: msg, text: '' }
  }

  const text = data.choices?.[0]?.message?.content || ''
  const usage = data.usage || {}
  return {
    ok: true,
    status: res.status,
    text,
    tokenUsage: {
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
    },
  }
}

/**
 * Prefer native API for AQ. auth keys; OpenAI-compatible for legacy AIza keys.
 * @param {{ apiKey: string, model: string, system?: string, user: string, temperature?: number, maxTokens?: number }} opts
 */
export async function geminiChat(opts) {
  const { apiKey } = opts
  if (isGeminiAuthKey(apiKey)) {
    return geminiNativeGenerateContent(opts)
  }
  return geminiOpenAiChatCompletions(opts)
}
