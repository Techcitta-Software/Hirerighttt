import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_GEMINI_FLASH_LITE,
  modelCascadeForTier,
  publicModelConfig,
  resolveGeminiModelId,
} from '../llmModels.mjs'

describe('llmModels', () => {
  it('defaults to gemini-3.1-flash-lite with no fallback in cascade', () => {
    const saved = {
      PRIMARY_MODEL: process.env.PRIMARY_MODEL,
      GEMINI_MODEL: process.env.GEMINI_MODEL,
      FAST_MODEL: process.env.FAST_MODEL,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    }
    try {
      delete process.env.PRIMARY_MODEL
      delete process.env.GEMINI_MODEL
      delete process.env.FAST_MODEL
      process.env.GEMINI_API_KEY = 'AQ.test-key-for-unit'

      assert.equal(resolveGeminiModelId(), DEFAULT_GEMINI_FLASH_LITE)
      assert.equal(modelCascadeForTier('quality').length, 1)
      assert.equal(modelCascadeForTier('fast').length, 1)
      assert.equal(modelCascadeForTier('quality')[0].name, DEFAULT_GEMINI_FLASH_LITE)

      const cfg = publicModelConfig()
      assert.equal(cfg.model, DEFAULT_GEMINI_FLASH_LITE)
      assert.equal(cfg.fallback, null)
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  })
})
