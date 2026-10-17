import { createApiDispatchMiddleware } from './apiDispatch.mjs'
import { createHealthRouter } from './health.routes.mjs'
import { createPlansRouter } from './plans.routes.mjs'
import { createAuthRouter } from './auth.routes.mjs'
import { createMailRouter } from './mail.routes.mjs'
import { createOrganizationRouter } from './organization.routes.mjs'
import { createLlmRouter } from './llm.routes.mjs'

/**
 * Wire HTTP routes (Express `app.use` style).
 * Domain handlers live under `routes/*.routes.mjs`; remaining paths use `apiDispatch.mjs`
 * until fully split (same behavior as monolithic index).
 *
 * @param {import('express').Express} app
 * @param {ReturnType<import('../server/appContext.mjs').createAppContext>} ctx
 */
export function registerRoutes(app, ctx) {
  const apiDispatch = createApiDispatchMiddleware(ctx)

  /** Assessment API (`/api/assessments/*`) — existing module */
  app.use(async (req, res, next) => {
    const url = new URL(req.originalUrl || req.url || '/', `http://localhost:${ctx.PORT}`)
    if (await ctx.assessmentHandler(req, res, url)) return
    if (await ctx.personalizedHandler(req, res, url)) return
    next()
  })

  app.use('/api', createHealthRouter(ctx))
  app.use('/api', createPlansRouter(ctx))
  app.use('/api', createMailRouter(ctx))
  app.use('/api', createOrganizationRouter(ctx))
  app.use('/api', createLlmRouter(ctx))
  app.use('/api', createAuthRouter(ctx))

  /** Jobs, vendor, interview, resume, talent, confidential vault, SPA fallback */
  app.use(apiDispatch)
}
