import { assertProductionConfig } from './config.mjs'
import { createAppContext } from './server/appContext.mjs'
import { createExpressApp } from './server/createApp.mjs'
import { geminiKeyFormatWarning, llmConfigured } from './interviewAgent.mjs'
import { resolveGeminiApiKey } from './geminiClient.mjs'

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

const server = app.listen(PORT, () => {
  console.log(`HIRERIGHT API v2 [Express] [${ctx.config.environment}] on http://localhost:${PORT}`)
  console.log('Storage: PostgreSQL (Neon)')
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
    console.warn(`Port ${PORT} already in use — API assumed running.`)
    return
  }
  console.error(err)
  process.exit(1)
})
