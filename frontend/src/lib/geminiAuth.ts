const GEMINI_NATIVE_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export function isGeminiAuthKey(apiKey: string): boolean {
  return apiKey.trim().startsWith('AQ.')
}

/** OpenAI-compatible Gemini chat/completions headers (legacy AIza keys). */
export function geminiOpenAiHeaders(apiKey: string): Record<string, string> {
  const key = apiKey.trim()
  if (isGeminiAuthKey(key)) {
    return { 'Content-Type': 'application/json', 'x-goog-api-key': key }
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
    'x-goog-api-key': key,
  }
}

export type GeminiChatRequest = {
  apiKey: string
  openAiBaseUrl: string
  model: string
  system?: string
  user: string
  temperature?: number
  maxTokens?: number
}

/** Auth keys (AQ.*) use native generateContent; AIza uses OpenAI-compatible endpoint. */
export async function geminiChatFetch(opts: GeminiChatRequest): Promise<Response> {
  const { apiKey, openAiBaseUrl, model, system, user, temperature = 0.3, maxTokens } = opts

  if (isGeminiAuthKey(apiKey)) {
    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature },
    }
    if (system?.trim()) {
      body.systemInstruction = { parts: [{ text: system.trim() }] }
    }
    if (maxTokens && maxTokens > 0) {
      ;(body.generationConfig as Record<string, number>).maxOutputTokens = maxTokens
    }
    return fetch(`${GEMINI_NATIVE_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey.trim() },
      body: JSON.stringify(body),
    })
  }

  const messages: { role: string; content: string }[] = []
  if (system?.trim()) messages.push({ role: 'system', content: system.trim() })
  messages.push({ role: 'user', content: user })

  const body: Record<string, unknown> = { model, temperature, messages }
  if (maxTokens && maxTokens > 0) body.max_tokens = maxTokens

  return fetch(`${openAiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: geminiOpenAiHeaders(apiKey),
    body: JSON.stringify(body),
  })
}

export function parseGeminiChatResponse(data: unknown): string {
  const d = data as {
    choices?: { message?: { content?: string } }[]
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const openAi = d.choices?.[0]?.message?.content
  if (openAi?.trim()) return openAi
  const parts = d.candidates?.[0]?.content?.parts || []
  return parts.map((p) => p.text || '').join('')
}
