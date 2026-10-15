/**
 * Model routing: quality vs fast. Defaults favor low-cost Gemini Flash Lite (works on current AI Studio keys).
 *
 * - PRIMARY_MODEL / gemini-3.5-flash-lite — interviews, resume JSON, scoring
 * - FAST_MODEL — same lite model for pings and short replies
 * - FALLBACK_MODEL — optional second lite id if primary is unavailable
 */

function uniqueModelNames(names) {
  const seen = new Set()
  const out = []
  for (const name of names) {
    const n = String(name || '').trim()
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

export function geminiApiConfigured() {
  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.LLM_API_KEY
  return Boolean(apiKey?.trim())
}

export { geminiKeyFormatWarning, isGeminiAuthKey, isGeminiStandardKey } from './geminiClient.mjs'

export function isGeminiProvider() {
  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.LLM_API_KEY ||
    ''
  const trimmed = apiKey.trim()
  return (
    Boolean(process.env.GEMINI_API_KEY) ||
    trimmed.startsWith('AIza') ||
    trimmed.startsWith('AQ.') ||
    process.env.OPENAI_BASE_URL?.includes('generativelanguage.googleapis.com')
  )
}

/** @param {'quality' | 'fast'} tier */
export function modelCascadeForTier(tier) {
  const gemini = isGeminiProvider()
  const lite = gemini ? 'gemini-3.5-flash-lite' : 'gpt-4o-mini'
  const primary =
    process.env.PRIMARY_MODEL || process.env.GEMINI_MODEL || lite
  const fast = process.env.FAST_MODEL || lite
  const fallback =
    process.env.FALLBACK_MODEL ||
    process.env.LITE_FALLBACK_MODEL ||
    lite

  if (tier === 'fast') {
    return uniqueModelNames([fast, fallback]).map((name, i) => ({
      name,
      label: i === 0 ? (gemini ? 'Gemini Fast' : name) : gemini ? 'Gemini Fallback' : name,
    }))
  }
  return uniqueModelNames([primary, fallback]).map((name, i) => ({
    name,
    label: i === 0 ? (gemini ? 'Gemini Quality' : name) : gemini ? 'Gemini Fallback' : name,
  }))
}

export function publicModelConfig() {
  const quality = modelCascadeForTier('quality')
  const fast = modelCascadeForTier('fast')
  return {
    provider: isGeminiProvider() ? 'google-gemini' : 'openai-compatible',
    quality: quality[0]?.name,
    qualityFallback: quality[1]?.name,
    fast: fast[0]?.name,
    fastFallback: fast[1]?.name,
  }
}
