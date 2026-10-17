import { Router } from 'express'

/** @param {ReturnType<import('../server/appContext.mjs').createAppContext>} ctx */
export function createOrganizationRouter(ctx) {
  const router = Router()
  const { json, loadDb, requireAuth, tenantContextForUser } = ctx

  router.get('/organization', async (req, res) => {
    const email = await requireAuth(req, res)
    if (!email) return
    const db = loadDb()
    const user = db.users.find((u) => u.email === email)
    if (!user) return json(res, 401, { error: 'Unauthorized' })
    const tenant = tenantContextForUser(db, user)
    if (!tenant.organization) {
      return json(res, 404, { error: 'No organization for this account.' })
    }
    const members = (db.organizationMembers || [])
      .filter((m) => m.organizationId === tenant.organization.id)
      .map((m) => {
        const u = db.users.find((x) => x.id === m.userId)
        return {
          userId: m.userId,
          role: m.role,
          email: u?.email,
          name: u?.name,
          joinedAt: m.joinedAt,
        }
      })
    const jobs = (db.jobs || []).filter((j) => j.organizationId === tenant.organization.id)
    return json(res, 200, {
      organization: tenant.organization,
      subscription: tenant.subscription,
      plan: tenant.plan,
      members,
      jobs,
    })
  })

  return router
}
