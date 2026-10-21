import { Router } from 'express'
import { pingDatabase } from '../db/store.mjs'
import { llmConfigured, publicModelConfig } from '../interviewAgent.mjs'
import { groqWhisperConfigured } from '../groqWhisper.mjs'
import { supabaseStorageConfigured } from '../resumeStorage.mjs'
import { objectStorageConfigured } from '../storage/resumeObjectStorage.mjs'
import { s3Env, s3StorageConfigured } from '../storage/s3ObjectStorage.mjs'

/** @param {ReturnType<import('../server/appContext.mjs').createAppContext>} ctx */
export function createHealthRouter(ctx) {
  const router = Router()
  const { json, config } = ctx

  router.get('/health', async (_req, res) => {
    const dbPing = await pingDatabase(config.databaseUrl)
    const deployRef =
      process.env.RENDER_GIT_COMMIT ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.GIT_COMMIT ||
      null
    const apiBuildId = process.env.API_BUILD_ID || 'hireright-neon-2026-10-16'
    const s3 = s3StorageConfigured() ? s3Env() : null
    let objectProvider = null
    if (s3StorageConfigured()) objectProvider = 's3'
    else if (process.env.DISABLE_SUPABASE !== 'true' && supabaseStorageConfigured()) {
      objectProvider = 'supabase'
    }
    return json(res, 200, {
      ok: true,
      service: 'hireright-api',
      version: '2.0.0',
      apiBuildId,
      deployRef,
      llm: llmConfigured(),
      models: publicModelConfig(),
      database: {
        configured: true,
        storage: 'postgresql',
        connected: Boolean(dbPing?.ok),
        detail: dbPing?.reason || null,
      },
      features: {
        interviewAgent: true,
        resumeAwareQuestions: true,
        adaptiveScoring: true,
        faceIntegrityClient: true,
        openrouterActive: Boolean(process.env.OPENROUTER_API_KEY),
        groqWhisper: groqWhisperConfigured(),
        sileroVad: groqWhisperConfigured(),
      },
      objectStorage: {
        configured: objectStorageConfigured(),
        provider: objectProvider,
        bucket: s3?.bucket || null,
        region: s3?.region || null,
        resumeKeyPrefix: 'resumes/',
      },
    })
  })

  return router
}
