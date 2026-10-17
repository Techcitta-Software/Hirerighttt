import express from 'express'
import { registerRoutes } from '../routes/registerRoutes.mjs'

/** @param {ReturnType<import('./appContext.mjs').createAppContext>} ctx */
export function createExpressApp(ctx) {
  const app = express()
  app.set('trust proxy', ctx.config.trustProxy)

  app.use((req, res, next) => {
    res.requestOrigin = req.headers.origin
    next()
  })

  app.options(/.*/, (req, res) => ctx.json(res, 204, {}))

  app.use(
    express.json({
      limit: ctx.config.maxBodyBytes,
      strict: true,
      type: ['application/json', 'application/*+json'],
    }),
  )

  app.use((err, req, res, next) => {
    if (err?.type === 'entity.parse.failed') {
      return ctx.json(res, 400, { error: 'Invalid JSON object' })
    }
    if (err?.type === 'entity.too.large') {
      return ctx.json(res, 413, { error: 'Body too large' })
    }
    next(err)
  })

  registerRoutes(app, ctx)

  return app
}
