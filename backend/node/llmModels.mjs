/**
 * Model routing: single Gemini Flash Lite id (no fallback cascade).
 *
 * Override with PRIMARY_MODEL / GEMINI_MODEL / FAST_MODEL (all should match for tests).
 */

export const DEFAULT_GEMINI_FLASH_LITE = 'gemini-3.1-flash-lite'

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

/** Resolved Gemini model id for all server LLM calls. */
export function resolveGeminiModelId() {
  const fromEnv =
    process.env.PRIMARY_MODEL ||
    process.env.GEMINI_MODEL ||
    process.env.FAST_MODEL ||
    ''
  return String(fromEnv).trim() || DEFAULT_GEMINI_FLASH_LITE
}

/** @param {'quality' | 'fast'} tier */
export function modelCascadeForTier(tier) {
  const gemini = isGeminiProvider()
  if (!gemini) {
    const name = process.env.PRIMARY_MODEL || 'gpt-4o-mini'
    return [{ name, label: name }]
  }
  const name = resolveGeminiModelId()
  const tierLabel = tier === 'fast' ? 'fast' : 'quality'
  return [{ name, label: `${name} (${tierLabel})`, tier }]
}

export function publicModelConfig() {
  const name = resolveGeminiModelId()
  return {
    provider: isGeminiProvider() ? 'google-gemini' : 'openai-compatible',
    model: name,
    quality: name,
    fast: name,
    fallback: null,
  }
}
