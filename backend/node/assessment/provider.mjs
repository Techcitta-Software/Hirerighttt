import { isGeminiProvider, modelCascadeForTier } from '../llmModels.mjs'
import { resolveGeminiApiKey } from '../geminiClient.mjs'
import { AssessmentError } from './contracts.mjs'

// A small provider boundary; tests inject this function without external API calls.
export async function structuredCall({ system, payload, validate, purpose, fetchImpl = fetch }) {
  const key = resolveGeminiApiKey()
  if (!key) throw new AssessmentError(503, 'Assessment AI provider is not configured')
  const gemini = isGeminiProvider()
  const model = (purpose === 'evaluation' ? process.env.ASSESSMENT_EVALUATION_MODEL : process.env.ASSESSMENT_PLAN_MODEL) || modelCascadeForTier('quality')[0].name
  const started = Date.now()
  let tokens = 0
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const base = (process.env.OPENAI_BASE_URL || (process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1')).replace(/\/$/, '')
      const url = gemini ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` : `${base}/chat/completions`
      const user = JSON.stringify(payload)
      const body = gemini ? {
        systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 12000 },
      } : { model, temperature: 0.2, response_format: { type: 'json_object' }, max_tokens: 12000, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }
      const response = await fetchImpl(url, { method: 'POST', signal: AbortSignal.timeout(30000), headers: { 'Content-Type': 'application/json', ...(gemini ? { 'x-goog-api-key': key } : { Authorization: `Bearer ${key}` }) }, body: JSON.stringify(body) })
      if (!response.ok) {
        if ([401, 403].includes(response.status)) break
        continue
      }
      const data = await response.json()
      tokens += Number(gemini ? data.usageMetadata?.totalTokenCount || 0 : data.usage?.total_tokens || 0)
      const raw = gemini ? (data.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('') : data.choices?.[0]?.message?.content
      const result = validate(JSON.parse(raw))
      return { data: result, model, provider: gemini ? 'gemini' : 'openai-compatible', tokens, latency_ms: Date.now() - started, attempts: attempt + 1 }
    } catch { /* Bounded retry for timeouts and malformed output. Never log candidate text. */ }
  }
  throw new AssessmentError(503, 'Assessment provider failed or returned invalid output; saved answers can be retried')
}
