import { Router } from 'express'
import { geminiChat, resolveGeminiApiKey } from '../geminiClient.mjs'
import { isGeminiProvider, publicModelConfig } from '../llmModels.mjs'

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
        message: 'No LLM API key set. Running in local agent mode.',
      })
    }

    const isGemini = isGeminiProvider()
    const models = publicModelConfig()
    const providerName = 'HireRight AI'

    try {
      if (isGemini) {
        const { modelCascadeForTier } = await import('../llmModels.mjs')
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
          statusCode: ping.status,
          message: 'Ava AI interview · using built-in question engine.',
        })
      }

      const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
      const model = models.fast || models.quality
      const pingRes = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'http://localhost:5173',
          'X-Title': 'HIRERIGHTTT',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Ping' }],
          max_tokens: 5,
        }),
      })
      if (pingRes.ok) {
        return json(res, 200, {
          active: true,
          configured: true,
          provider: providerName,
          model: 'hireright-ai',
          statusCode: pingRes.status,
          message: 'Ava AI interview is ready.',
          models,
        })
      }
      return json(res, 200, {
        active: false,
        configured: true,
        provider: providerName,
        model: 'hireright-ai',
        statusCode: pingRes.status,
        message: 'Ava AI interview · using built-in question engine.',
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
