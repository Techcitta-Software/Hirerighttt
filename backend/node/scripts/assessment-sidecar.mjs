/**
 * Exact Node handlers for /api/assessments/* and personalized interview sessions.
 * Python proxies here so those flows match the original Express backend.
 */
import express from 'express'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const { loadEnv } = await import(join(repoRoot, 'env', 'loadEnv.mjs'))
loadEnv()

const port = Number(process.env.ASSESSMENT_SIDECAR_PORT || 8788)
process.env.PORT = String(port)

const { createAppContext } = await import('../server/appContext.mjs')
const ctx = createAppContext()
await ctx.bootstrapDb()

const app = express()
app.use(express.json({ limit: '3mb' }))

app.use(async (req, res) => {
  const url = new URL(req.originalUrl || req.url, `http://127.0.0.1:${port}`)
  if (await ctx.assessmentHandler(req, res, url)) return
  if (await ctx.personalizedHandler(req, res, url)) return
  ctx.json(res, 421, { passthrough: true })
})

app.listen(port, '127.0.0.1', () => {
  console.log(`[node-compat] assessments + personalized interview on http://127.0.0.1:${port}`)
})
