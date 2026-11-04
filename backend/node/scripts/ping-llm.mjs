import { loadEnv } from '../loadEnv.mjs'
import { publicModelConfig, modelCascadeForTier } from '../llmModels.mjs'
import { geminiChat, resolveGeminiApiKey, isGeminiAuthKey } from '../geminiClient.mjs'

loadEnv()
const apiKey = resolveGeminiApiKey()
if (!apiKey) {
  console.error('[ping-llm] No GEMINI_API_KEY (or GOOGLE_API_KEY) set in repo-root .env')
  process.exit(1)
}

const models = publicModelConfig()
const cascade = modelCascadeForTier('fast')

console.log('[ping-llm] provider: gemini')
console.log('[ping-llm] model (no fallback):', cascade.map((c) => c.name).join(', '))
console.log(
  '[ping-llm] key type:',
  isGeminiAuthKey(apiKey) ? 'AQ. auth (native API)' : apiKey.startsWith('AIza') ? 'AIza standard' : 'other',
)
console.log('[ping-llm] key prefix:', apiKey.trim().slice(0, 4) + '…')

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
