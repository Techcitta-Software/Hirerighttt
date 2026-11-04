import { Router } from 'express'
import { geminiChat, resolveGeminiApiKey } from '../geminiClient.mjs'
import { modelCascadeForTier, publicModelConfig } from '../llmModels.mjs'

/** @param {ReturnType<import('../server/appContext.mjs').createAppContext>} ctx */
export function createLlmRouter(ctx) {
  const router = Router()
  const { json } = ctx

  router.get('/llm-status', async (_req, res) => {
    const apiKey = resolveGeminiApiKey()
    if (!apiKey) {
      return json(res, 200, {
        active: false,
        configured: false,
        provider: 'Built-in Local Agent',
        message: 'Set GEMINI_API_KEY to enable Ava AI (Google Gemini).',
      })
    }

    const models = publicModelConfig()
    const providerName = 'HireRight AI · Google Gemini'

    try {
      let ping = null
      let model = models.fast || models.quality
      for (const candidate of modelCascadeForTier('fast')) {
        model = candidate.name
        ping = await geminiChat({
          apiKey,
          model,
          user: 'Ping',
          temperature: 0,
          maxTokens: 5,
        })
        if (ping.ok) break
      }
      if (ping?.ok) {
        return json(res, 200, {
          active: true,
          configured: true,
          provider: providerName,
          model: 'hireright-ai',
          statusCode: ping.status,
          authMode: apiKey.startsWith('AQ.') ? 'gemini-auth-key-native' : 'gemini-openai-compatible',
          message: 'Ava AI interview is ready.',
          models,
        })
      }
      return json(res, 200, {
        active: false,
        configured: true,
        provider: providerName,
        model: 'hireright-ai',
        statusCode: ping?.status,
        message: 'Gemini key present but ping failed — using built-in question engine.',
      })
    } catch {
      return json(res, 200, {
        active: false,
        configured: true,
        provider: providerName,
        model: 'hireright-ai',
        message: 'Ava AI interview · using built-in question engine.',
      })
    }
  })

  return router
}
