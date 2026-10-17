import { Router } from 'express'

/** @param {ReturnType<import('../server/appContext.mjs').createAppContext>} ctx */
export function createPlansRouter(ctx) {
  const router = Router()
  const { json, loadDb } = ctx

  router.get('/plans', (_req, res) => {
    const db = loadDb()
    const plans = (db.subscriptionPlans || []).filter((p) => p.isPublic !== false)
    return json(res, 200, { plans })
  })

  return router
}
