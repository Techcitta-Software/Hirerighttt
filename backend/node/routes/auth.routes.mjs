import { Router } from 'express'
import { randomBytes } from 'node:crypto'
import { loadDb as reloadDbFromStore } from '../db/store.mjs'
import { upsertCandidateTalent } from '../db/talentIndex.mjs'

/** @param {ReturnType<import('../server/appContext.mjs').createAppContext>} ctx */
export function createAuthRouter(ctx) {
  const router = Router()
  const {
    config,
    isProdLike,
    json,
    readBody,
    rateLimit,
    clientIp,
    requireAuth,
    registerSession,
    loadDb,
    saveDb,
    setDbCache,
    tenantContextForUser,
    authHelpers,
  } = ctx
  const {
    hashPassword,
    verifyPassword,
    registerAccount,
    UniqueAccountError,
    validateEmployerSignup,
    loginRoleMismatchMessage,
    normalizePhone,
    isValidPhoneInput,
    findUserByPhone,
    deleteSessionToken,
  } = authHelpers

  router.post('/signup', async (req, res) => {
    const ip = clientIp(req)
    if (!config.signupEnabled) {
      return json(res, 403, { error: 'Sign-up is disabled on this deployment.' })
    }
    if (isProdLike && !rateLimit(`signup:${ip}`, 8)) {
      return json(res, 429, { error: 'Too many signup attempts. Try again shortly.' })
    }
    const body = await readBody(req)
    const name = String(body.name || '').trim()
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    if (!name || !email || password.length < 6 || password.length > 1024) {
      return json(res, 400, { error: 'Name, email, and 6+ char password required.' })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(res, 400, { error: 'Enter a valid email address.' })
    }
    const phoneRaw = String(body.phone || '').trim()
    if (!isValidPhoneInput(phoneRaw)) {
      return json(res, 400, {
        error: 'A valid mobile number is required at signup (10–15 digits, include country code if needed).',
      })
    }
    const phone = normalizePhone(phoneRaw)
    const db = loadDb()
    if (db.users.some((u) => u.email === email)) {
      return json(res, 409, {
        error:
          'An account with this email already exists. Each email can only be registered once as either a candidate or a vendor (employer).',
      })
    }
    if (findUserByPhone(db.users, phoneRaw)) {
      return json(res, 409, { error: 'An account with this mobile number already exists.' })
    }
    const role = body.role === 'employer' ? 'employer' : 'jobseeker'
    const companyName = String(body.companyName || '').trim()
    const employerErr = validateEmployerSignup(role, companyName)
    if (employerErr) return json(res, 400, { error: employerErr })
    const createdAt = new Date().toISOString()
    let user
    try {
      const registered = await registerAccount(config.databaseUrl, {
        id: randomBytes(8).toString('hex'),
        name,
        email,
        phone,
        passwordHash: await hashPassword(password),
        role,
        companyName: role === 'employer' ? companyName : undefined,
        createdAt,
      })
      user = registered.user
      setDbCache(await reloadDbFromStore(config.databaseUrl))
    } catch (err) {
      if (err instanceof UniqueAccountError) {
        return json(res, 409, { error: err.message })
      }
      throw err
    }
    if (role !== 'employer' && config.databaseUrl) {
      await upsertCandidateTalent(config.databaseUrl, user, {}, null)
    }
    const token = randomBytes(16).toString('hex')
    await registerSession(token, email)
    return json(res, 201, {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        companyName: user.companyName,
        phone: user.phone,
      },
    })
  })

  router.post('/login', async (req, res) => {
    const ip = clientIp(req)
    if (!rateLimit(`login:${ip}`, 20)) {
      return json(res, 429, { error: 'Too many login attempts. Try again shortly.' })
    }
    const body = await readBody(req)
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    const db = loadDb()
    const user = db.users.find((u) => u.email === email)
    if (!user || user.status !== 'active' || !(await verifyPassword(password, user.passwordHash))) {
      return json(res, 401, { error: 'Email or password is incorrect.' })
    }
    const expectedRole =
      body.expectedRole === 'employer' || body.expectedRole === 'jobseeker'
        ? body.expectedRole
        : null
    const actualRole = user.role === 'employer' ? 'employer' : 'jobseeker'
    const roleErr = loginRoleMismatchMessage(expectedRole, actualRole)
    if (roleErr) return json(res, 403, { error: roleErr })
    if (!user.passwordHash.startsWith('scrypt$')) {
      user.passwordHash = await hashPassword(password)
      await saveDb(db)
    }
    const token = randomBytes(16).toString('hex')
    await registerSession(token, email)
    return json(res, 200, {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: actualRole,
        companyName: user.companyName,
        phone: user.phone,
        primaryOrganizationId: user.primaryOrganizationId,
      },
    })
  })

  router.post('/logout', async (req, res) => {
    const header = req.headers.authorization || ''
    const token = header.replace(/^Bearer\s+/i, '')
    await deleteSessionToken(config.databaseUrl, token)
    return json(res, 200, { ok: true })
  })

  router.get('/me', async (req, res) => {
    const email = await requireAuth(req, res)
    if (!email) return
    const db = loadDb()
    const user = db.users.find((u) => u.email === email)
    if (!user) return json(res, 401, { error: 'Unauthorized' })
    const tenant = tenantContextForUser(db, user)
    return json(res, 200, {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role === 'employer' ? 'employer' : 'jobseeker',
        companyName: user.companyName,
        phone: user.phone,
        primaryOrganizationId: user.primaryOrganizationId,
      },
      organization: tenant.organization,
      subscription: tenant.subscription,
      plan: tenant.plan
        ? {
            id: tenant.plan.id,
            code: tenant.plan.code,
            name: tenant.plan.name,
            limits: tenant.plan.limits,
            features: tenant.plan.features,
          }
        : null,
      profile: db.profiles[email] || null,
      interview: db.interviews[email] || null,
      applications: db.applications[email] || [],
    })
  })

  router.put('/profile', async (req, res) => {
    const email = await requireAuth(req, res)
    if (!email) return
    const body = await readBody(req)
    const db = loadDb()
    const prev = /** @type {Record<string, unknown>} */ (db.profiles[email] || {})
    db.profiles[email] = {
      ...prev,
      ...body,
      updatedAt: new Date().toISOString(),
    }
    await saveDb(db)
    const account = db.users.find((u) => u.email === email)
    if (account && config.databaseUrl) {
      try {
        await upsertCandidateTalent(
          config.databaseUrl,
          account,
          db.profiles[email],
          db.interviews[email],
        )
      } catch (err) {
        console.warn('[talent] profile index:', err instanceof Error ? err.message : err)
      }
    }
    return json(res, 200, { profile: db.profiles[email] })
  })

  return router
}
