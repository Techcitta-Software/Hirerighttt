import { isGeminiProvider, modelCascadeForTier } from '../llmModels.mjs'
import { resolveGeminiApiKey } from '../geminiClient.mjs'
import { AssessmentError } from './contracts.mjs'

// A small provider boundary; tests inject this function without external API calls.
export async function structuredCall({ system, payload, validate, purpose, fetchImpl = fetch }) {
  const key = resolveGeminiApiKey()
  if (!key) throw new AssessmentError(503, 'Assessment AI provider is not configured')
  if (!isGeminiProvider()) throw new AssessmentError(503, 'Assessment AI requires GEMINI_API_KEY')
  const model = (purpose === 'evaluation' ? process.env.ASSESSMENT_EVALUATION_MODEL : process.env.ASSESSMENT_PLAN_MODEL) || modelCascadeForTier('quality')[0].name
  const started = Date.now()
  let tokens = 0
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
      const user = JSON.stringify(payload)
      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 12000 },
      }
      const response = await fetchImpl(url, {
        method: 'POST',
        signal: AbortSignal.timeout(30000),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        if ([401, 403].includes(response.status)) break
        continue
      }
      const data = await response.json()
      tokens += Number(data.usageMetadata?.totalTokenCount || 0)
      const raw = (data.candidates?.[0]?.content?.parts || [])
        .filter((p) => !p.thought)
        .map((p) => p.text || '')
        .join('')
      const result = validate(JSON.parse(raw))
      return { data: result, model, provider: 'gemini', tokens, latency_ms: Date.now() - started, attempts: attempt + 1 }
    } catch { /* Bounded retry for timeouts and malformed output. Never log candidate text. */ }
  }
  throw new AssessmentError(503, 'Assessment provider failed or returned invalid output; saved answers can be retried')
}
