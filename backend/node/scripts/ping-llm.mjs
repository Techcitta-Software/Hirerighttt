import { loadEnv } from '../loadEnv.mjs'
import { publicModelConfig, isGeminiProvider, modelCascadeForTier } from '../llmModels.mjs'
import { geminiChat, resolveGeminiApiKey, isGeminiAuthKey } from '../geminiClient.mjs'

loadEnv()
const apiKey = resolveGeminiApiKey()
if (!apiKey) {
  console.error('[ping-llm] No GEMINI_API_KEY / OPENAI_API_KEY set in repo-root .env')
  process.exit(1)
}

const isGemini = isGeminiProvider()
const models = publicModelConfig()
const cascade = modelCascadeForTier('fast')

console.log('[ping-llm] provider:', isGemini ? 'gemini' : 'openai-compatible')
console.log('[ping-llm] cascade:', cascade.map((c) => c.name).join(' → '))
console.log(
  '[ping-llm] key type:',
  isGeminiAuthKey(apiKey) ? 'AQ. auth (native API)' : apiKey.startsWith('AIza') ? 'AIza standard' : 'other',
)
console.log('[ping-llm] key prefix:', apiKey.trim().slice(0, 4) + '…')

if (isGemini) {
  for (const { name: model, label } of cascade) {
    const result = await geminiChat({
      apiKey,
      model,
      user: 'Say OK',
      temperature: 0,
      maxTokens: 8,
    })
    console.log(`[ping-llm] ${label} (${model}) HTTP`, result.status)
    if (result.ok) {
      console.log('[ping-llm] OK — response:', result.text.trim() || '(empty)')
      console.log('[ping-llm] config:', JSON.stringify(models))
      process.exit(0)
    }
    console.warn('[ping-llm] try next:', result.error?.slice(0, 120))
  }
  console.error('[ping-llm] FAILED: all models in fast cascade rejected the request')
  process.exit(1)
}

const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
const res = await fetch(`${base}/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    model,
    messages: [{ role: 'user', content: 'Say OK' }],
    max_tokens: 8,
  }),
})
const text = await res.text()
console.log('[ping-llm] HTTP', res.status)
if (res.ok) {
  console.log('[ping-llm] OK')
  process.exit(0)
}
console.error('[ping-llm] FAILED:', text.slice(0, 400))
process.exit(1)
