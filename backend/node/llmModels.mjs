/**
 * Model routing: single Gemini Flash Lite id (no fallback cascade).
 *
 * Override with PRIMARY_MODEL / GEMINI_MODEL / FAST_MODEL (all should match for tests).
 */

import { resolveGeminiApiKey } from './geminiClient.mjs'

export const DEFAULT_GEMINI_FLASH_LITE = 'gemini-3.1-flash-lite'

export { geminiKeyFormatWarning, isGeminiAuthKey, isGeminiStandardKey } from './geminiClient.mjs'

export function geminiApiConfigured() {
  return Boolean(resolveGeminiApiKey())
}

/** All server LLM traffic uses Google Gemini (AI Studio key). */
export function isGeminiProvider() {
  return geminiApiConfigured()
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
  const name = resolveGeminiModelId()
  const tierLabel = tier === 'fast' ? 'fast' : 'quality'
  return [{ name, label: `${name} (${tierLabel})`, tier }]
}

export function publicModelConfig() {
  const name = resolveGeminiModelId()
  return {
    provider: 'google-gemini',
    model: name,
    quality: name,
    fast: name,
    fallback: null,
  }
}
