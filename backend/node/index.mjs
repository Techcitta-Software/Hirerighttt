import { assertProductionConfig } from './config.mjs'
import { createAppContext } from './server/appContext.mjs'
import { createExpressApp } from './server/createApp.mjs'
import { geminiKeyFormatWarning, llmConfigured } from './interviewAgent.mjs'
import { resolveGeminiApiKey } from './geminiClient.mjs'
import { s3Env, s3StorageConfigured } from './storage/s3ObjectStorage.mjs'
import { verifyConfiguredS3Bucket } from './storage/s3StartupVerify.mjs'
import { supabaseStorageConfigured } from './resumeStorage.mjs'

assertProductionConfig()

const ctx = createAppContext()

try {
  await ctx.bootstrapDb()
} catch (err) {
  console.error('[db] Failed to connect or load PostgreSQL:', err instanceof Error ? err.message : err)
  process.exit(1)
}

const app = createExpressApp(ctx)
const PORT = ctx.PORT

const server = app.listen(PORT, async () => {
  console.log(`HIRERIGHT API v2 [Express] [${ctx.config.environment}] on http://localhost:${PORT}`)
  console.log('Storage: PostgreSQL (Neon)')
  if (s3StorageConfigured()) {
    const { bucket, region } = s3Env()
    try {
      await verifyConfiguredS3Bucket()
      console.log(
        `Object storage: Amazon S3 ONLY (bucket=${bucket}, region=${region}) — all Put/Get use env S3_BUCKET; Neon stores keys only`,
      )
    } catch (verifyErr) {
      console.error('[s3]', verifyErr instanceof Error ? verifyErr.message : verifyErr)
      if (ctx.config.environment === 'production') {
        process.exit(1)
      }
      console.warn('[s3] Dev mode: API started but S3 may be misconfigured — fix .env and restart')
    }
  } else if (supabaseStorageConfigured()) {
    console.log('Object storage: Supabase (resume files)')
  } else {
    console.warn(
      'Object storage: NOT configured — resume files stay parsed text only (add AWS_REGION + S3_BUCKET to repo-root .env)',
    )
  }
  if (process.env.DISABLE_SUPABASE === 'true') {
    console.log('Supabase: disabled (Neon + S3/API stack)')
  }
  if (ctx.serveFrontend) {
    console.log(`Frontend SPA: serving ${ctx.frontendDistRoot} (unknown routes → index.html)`)
  }
  const geminiHint = geminiKeyFormatWarning()
  if (geminiHint) console.warn(`[llm] ${geminiHint}`)
  const key = resolveGeminiApiKey()
  const authLabel = key.startsWith('AQ.') ? 'Gemini auth key (AQ.)' : 'Gemini'
  console.log(
    `Interview agent: ${llmConfigured() && !geminiHint ? `LLM enabled (${authLabel})` : geminiHint ? 'LLM key unrecognized — check GEMINI_API_KEY' : 'local adaptive agent (set GEMINI_API_KEY)'}`,
  )
  console.log(`Demo accounts: ${ctx.config.allowDemoAccounts ? 'enabled' : 'disabled'}`)
})

server.on('error', (err) => { 
  if (err && err.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} already in use — another API is still running (often stale S3 config).`,
    )
    console.error('Stop it and restart: npm run dev:all  (or run: node scripts/ensure-dev-api-port.mjs)')
    process.exit(1)
  }
  console.error(err)
  process.exit(1)
})
