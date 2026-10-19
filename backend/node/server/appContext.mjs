import { randomBytes } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, extname, normalize, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { hashPassword, verifyPassword } from '../authPasswords.mjs'
import { registerAccount, UniqueAccountError } from '../authRegister.mjs'
import { validateEmployerSignup, loginRoleMismatchMessage } from '../authRoles.mjs'
import { normalizePhone, isValidPhoneInput, findUserByPhone } from '../authPhone.mjs'
import { createAssessmentHandler } from '../assessment/routes.mjs'
import { createPersonalizedHandler } from '../assessment/personalizedRoutes.mjs'
import { config, isProdLike } from '../config.mjs'
import { provisionEmployerTenant } from '../db/saasHelpers.mjs'
import {
  loadDb as loadDbFromStore,
  saveDb as persistDb,
  saveSessionToken,
  resolveSessionEmail,
  deleteSessionToken,
  emptyDb,
} from '../db/store.mjs'
import { reindexTalentFromDb } from '../db/talentIndex.mjs'
import { getOrgApplication, updateApplicationInterview } from '../vendor/jobs.mjs'
import { resolveCandidateName } from '../interviewAgent.mjs'

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const frontendDistFromEnv = (process.env.FRONTEND_DIST || '').trim()
const frontendDistDefault = join(repoRoot, 'frontend', 'dist')
const frontendDistRoot = resolve(frontendDistFromEnv || frontendDistDefault)
const serveFrontend =
  process.env.SERVE_FRONTEND === 'true' ||
  (isProdLike &&
    process.env.SERVE_FRONTEND !== 'false' &&
    existsSync(join(frontendDistRoot, 'index.html')))

const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
}

const PADDLE_SCRIPT_PATH = [
  new URL('../python/paddle_resume_parser.py', import.meta.url),
  new URL('../../python/paddle_resume_parser.py', import.meta.url),
  new URL('../paddle_resume_parser.py', import.meta.url),
]
  .map((u) => fileURLToPath(u))
  .find((p) => existsSync(p)) ||
  fileURLToPath(new URL('../../python/paddle_resume_parser.py', import.meta.url))

export function createAppContext() {
  let dbCache = emptyDb()

  async function seedDemoUsers(db) {
    if (!config.allowDemoAccounts) return db
    const demos = [
      {
        name: 'Arjun Sharma',
        email: 'demo@hireright.com',
        password: 'password123',
        phone: '+919000000001',
        role: 'jobseeker',
      },
      {
        name: 'Sarah Jenkins (Recruiter)',
        email: 'employer@hireright.com',
        password: 'password123',
        phone: '+919000000002',
        role: 'employer',
        companyName: 'TechCitta Solutions',
      },
      {
        name: 'Alex Morgan (Admin)',
        email: 'admin@hireright.com',
        password: 'password123',
        phone: '+919000000003',
        role: 'employer',
        companyName: 'HIRERIGHT Recruiting',
      },
    ]
    let changed = false
    for (const demo of demos) {
      if (!db.users.some((u) => u.email === demo.email)) {
        db.users.push({
          id: randomBytes(8).toString('hex'),
          name: demo.name,
          email: demo.email,
          phone: demo.phone,
          passwordHash: await hashPassword(demo.password),
          role: demo.role,
          companyName: demo.companyName,
          status: 'active',
          createdAt: new Date().toISOString(),
        })
        changed = true
      }
    }
    for (const demo of demos) {
      if (demo.role !== 'employer') continue
      const account = db.users.find((u) => u.email === demo.email)
      if (account) {
        const before = db.organizations?.length || 0
        provisionEmployerTenant(db, account, { planId: 'plan-pro' })
        if ((db.organizations?.length || 0) > before) changed = true
      }
    }
    if (changed) await saveDb(db)
    return db
  }

  function tenantContextForUser(db, user) {
    if (!user) return { organization: null, subscription: null, plan: null, membership: null }
    const membership =
      db.organizationMembers?.find(
        (m) => m.userId === user.id && m.organizationId === user.primaryOrganizationId,
      ) || db.organizationMembers?.find((m) => m.userId === user.id)
    const organization = membership
      ? db.organizations?.find((o) => o.id === membership.organizationId)
      : null
    const subscription = organization
      ? db.organizationSubscriptions?.find((s) => s.organizationId === organization.id)
      : null
    const plan = subscription
      ? db.subscriptionPlans?.find((p) => p.id === subscription.planId)
      : null
    return { organization, subscription, plan, membership }
  }

  function loadDb() {
    return dbCache
  }

  async function saveDb(db) {
    dbCache = db
    await persistDb(db, config.databaseUrl)
  }

  function getDbCache() {
    return dbCache
  }

  function setDbCache(db) {
    dbCache = db
  }

  async function bootstrapDb() {
    let raw = await loadDbFromStore(config.databaseUrl)
    if (!raw.users) raw.users = []
    if (!raw.profiles) raw.profiles = {}
    if (!raw.interviews) raw.interviews = {}
    if (!raw.applications) raw.applications = {}
    if (!raw.interviewSessions) raw.interviewSessions = {}
    if (!raw.confidentialVault) raw.confidentialVault = []
    if (!raw.organizations) raw.organizations = []
    if (!raw.organizationMembers) raw.organizationMembers = []
    if (!raw.organizationSubscriptions) raw.organizationSubscriptions = []
    if (!raw.subscriptionPlans) raw.subscriptionPlans = []
    if (!raw.jobs) raw.jobs = []
    if (!raw.employerApplications) raw.employerApplications = []
    dbCache = await seedDemoUsers(raw)
    await persistDb(dbCache, config.databaseUrl)
    if (config.databaseUrl) {
      try {
        const { indexed } = await reindexTalentFromDb(config.databaseUrl, dbCache)
        if (indexed > 0) console.log(`[talent] Indexed ${indexed} candidate profile(s) for employer search.`)
      } catch (err) {
        console.warn('[talent] Index sync skipped:', err instanceof Error ? err.message : err)
      }
    }
  }

  function json(res, status, body) {
    const payload = JSON.stringify(body)
    const origin = res.requestOrigin
    let corsOrigin = '*'
    if (isProdLike) {
      if (origin && config.corsOrigins.includes(origin)) corsOrigin = origin
      else if (config.corsOrigins[0]) corsOrigin = config.corsOrigins[0]
    } else if (origin) {
      corsOrigin = origin
    }
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      Vary: 'Origin',
    }
    if (isProdLike) {
      headers['X-Content-Type-Options'] = 'nosniff'
      headers['X-Frame-Options'] = 'DENY'
      headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    }
    res.writeHead(status, headers)
    res.end(payload)
  }

  function readBody(req) {
    if (req.parsedBody) return Promise.resolve(req.parsedBody)
    if (req.body !== undefined) {
      const body = req.body
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return Promise.reject(Object.assign(new Error('Invalid JSON object'), { status: 400 }))
      }
      return Promise.resolve(body)
    }
    return Promise.resolve({})
  }

  const rateBuckets = new Map()

  function rateLimit(key, limit = 30, windowMs = 60_000) {
    const now = Date.now()
    const list = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs)
    if (list.length >= limit) return false
    list.push(now)
    rateBuckets.set(key, list)
    return true
  }

  function clientIp(req) {
    if (config.trustProxy) {
      const forwarded = req.headers['x-forwarded-for']
      const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded
      const first = raw?.split(',')[0]?.trim()
      if (first) return first
    }
    return req.socket.remoteAddress || 'local'
  }

  async function authEmail(req) {
    const header = req.headers.authorization || ''
    const token = header.replace(/^Bearer\s+/i, '')
    if (!token) return null
    return resolveSessionEmail(config.databaseUrl, token)
  }

  async function requireAuth(req, res) {
    const email = await authEmail(req)
    if (!email) {
      json(res, 401, { error: 'Unauthorized' })
      return null
    }
    let active = dbCache.users.some((user) => user.email === email && user.status === 'active')
    if (!active && config.databaseUrl) {
      try {
        const fresh = await loadDbFromStore(config.databaseUrl)
        const hit = fresh.users.find((u) => u.email === email && u.status === 'active')
        if (hit && !dbCache.users.some((u) => u.email === email)) {
          dbCache.users.push(hit)
        }
        active = Boolean(hit)
      } catch {
        active = false
      }
    }
    if (!active) {
      json(res, 401, { error: 'Unauthorized' })
      return null
    }
    return email
  }

  async function registerSession(token, email) {
    await saveSessionToken(config.databaseUrl, token, email)
  }

  function isDemoDisplayName(name) {
    const t = String(name || '').trim()
    return !t || t === 'Arjun Sharma' || /^arjun\s+sharma$/i.test(t)
  }

  function mergeInterviewProfile(db, email, bodyProfile) {
    const account = email ? db.users.find((u) => u.email === email) : null
    const stored = email ? /** @type {Record<string, unknown>} */ (db.profiles[email] || {}) : {}
    const merged = { ...stored, ...(bodyProfile || {}) }
    const clientName = String(
      bodyProfile?.fullName || bodyProfile?.name || merged.fullName || merged.name || '',
    ).trim()
    if (clientName && !isDemoDisplayName(clientName)) {
      return { ...merged, fullName: clientName, name: clientName }
    }
    const resolved = resolveCandidateName(merged, account?.name)
    return { ...merged, fullName: resolved, name: resolved }
  }

  function mergeTurnIntoInterviewHistory(history, lastQuestion, lastAnswer) {
    const list = Array.isArray(history) ? [...history] : []
    if (!lastQuestion) return list
    const qText = String(lastQuestion.text || lastQuestion || '').trim()
    if (!qText) return list
    const last = list[list.length - 1]
    if (last && String(last.question?.text || last.question || '').trim() === qText) {
      return list
    }
    list.push({ question: lastQuestion, answer: String(lastAnswer ?? '') })
    return list
  }

  function buildEmployerInviteContext(db, app, job) {
    const email = String(app.candidateEmail || '').toLowerCase()
    const profile = db.profiles?.[email] || {}
    return {
      source: 'employer',
      resumeText: String(app.data?.resumeText || profile.resumeText || '').slice(0, 80000),
      resumeName: app.data?.resumeName || profile.resumeName || null,
      jobDescription: String(job?.jobDescription || app.data?.jobDescription || '').slice(0, 80000),
      roleTrack: job?.roleTrack || app.data?.candidateRole || '',
      experienceLevel: app.data?.experienceYears || job?.experienceLevel || '',
      primarySkills: app.data?.primarySkills || job?.requiredSkills || [],
      candidateRole: app.data?.candidateRole || profile.currentRole || '',
    }
  }

  function buildJobSeekerInviteContext(db, email, body = {}) {
    const profile = db.profiles?.[email] || {}
    return {
      source: 'jobseeker',
      resumeText: String(profile.resumeText || body.resumeText || '').slice(0, 80000),
      resumeName: profile.resumeName || body.resumeName || null,
      jobDescription: String(body.jobDescription || '').slice(0, 80000),
      roleTrack: body.roleTrack || profile.currentRole || '',
      experienceLevel: body.experienceLevel || profile.totalExperience || '',
      primarySkills: body.primarySkills || profile.skills || [],
      jobTitle: body.jobTitle || '',
    }
  }

  async function runPaddleOcrParser(buffer, originalFileName = 'resume.pdf') {
    const ext = extname(originalFileName) || '.pdf'
    const tempPath = join(
      tmpdir(),
      `hireright-resume-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`,
    )
    await writeFile(tempPath, buffer)

    const pythonCmd = process.platform === 'win32' ? 'py' : 'python3'
    const pythonArgs =
      process.platform === 'win32'
        ? ['-3.12', PADDLE_SCRIPT_PATH, tempPath]
        : [PADDLE_SCRIPT_PATH, tempPath]

    return new Promise((resolvePromise) => {
      execFile(
        pythonCmd,
        pythonArgs,
        { maxBuffer: 10 * 1024 * 1024, timeout: 60_000 },
        async (err, stdout, stderr) => {
          try {
            await unlink(tempPath)
          } catch {
            // ignore
          }
          if (err) {
            console.warn('[PaddleOCR] Execution notice:', err.message, stderr)
            return resolvePromise(null)
          }
          try {
            const parsed = JSON.parse(stdout.trim())
            if (parsed && !parsed.error) {
              return resolvePromise(parsed)
            }
          } catch (jsonErr) {
            console.warn('[PaddleOCR] JSON parse notice:', jsonErr.message)
          }
          resolvePromise(null)
        },
      )
    })
  }

  function serveSpaStatic(req, res, urlPath) {
    if (!serveFrontend || (req.method !== 'GET' && req.method !== 'HEAD')) return false
    if (urlPath.startsWith('/api')) return false

    const safePath = normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, '')
    let filePath = join(frontendDistRoot, safePath === '/' ? 'index.html' : safePath)
    if (!filePath.startsWith(frontendDistRoot)) {
      filePath = join(frontendDistRoot, 'index.html')
    } else {
      try {
        const st = statSync(filePath)
        if (st.isDirectory()) filePath = join(filePath, 'index.html')
      } catch {
        filePath = join(frontendDistRoot, 'index.html')
      }
    }

    if (!existsSync(filePath)) {
      filePath = join(frontendDistRoot, 'index.html')
    }

    const type = STATIC_MIME[extname(filePath).toLowerCase()] || 'application/octet-stream'
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': urlPath === '/' ? 'no-cache' : 'public, max-age=3600',
    })
    if (req.method === 'HEAD') {
      res.end()
      return true
    }
    createReadStream(filePath).pipe(res)
    return true
  }

  async function requireEmployerTenant(req, res, db) {
    const authEmailValue = await requireAuth(req, res)
    if (!authEmailValue) return null
    const user = db.users.find((u) => u.email === authEmailValue)
    if (!user || user.role !== 'employer') {
      json(res, 403, { error: 'Employer account required.' })
      return null
    }
    const tenant = tenantContextForUser(db, user)
    if (!tenant.organization?.id) {
      json(res, 403, { error: 'No organization linked to this employer account.' })
      return null
    }
    const memberRole = tenant.membership?.role || ''
    if (!['owner', 'admin', 'recruiter'].includes(memberRole)) {
      json(res, 403, { error: 'Recruiter access required for this organization.' })
      return null
    }
    return { user, tenant }
  }

  const assessmentHandler = createAssessmentHandler({
    databaseUrl: config.databaseUrl,
    requireAuth,
    readBody,
    json,
    rateLimit,
  })

  const personalizedHandler = createPersonalizedHandler({
    databaseUrl: config.databaseUrl,
    requireAuth,
    readBody,
    json,
    rateLimit,
    onResult: async (email, result, link, organizationId) => {
      const db = loadDb()
      db.interviews[email] = result
      if (link.application_id) {
        const app = getOrgApplication(db, organizationId, link.application_id)
        if (!app || app.candidateEmail !== email) {
          throw Object.assign(new Error('Application not found'), { status: 404 })
        }
        updateApplicationInterview(db, app.id, organizationId, result, {
          assessmentSessionId: result.sessionId,
          vendorReport: null,
        })
      }
      await saveDb(db)
    },
  })

  return {
    config,
    isProdLike,
    PORT: config.port,
    serveFrontend,
    frontendDistRoot,
    loadDb,
    saveDb,
    getDbCache,
    setDbCache,
    bootstrapDb,
    json,
    readBody,
    rateLimit,
    clientIp,
    requireAuth,
    authEmail,
    registerSession,
    tenantContextForUser,
    requireEmployerTenant,
    mergeInterviewProfile,
    mergeTurnIntoInterviewHistory,
    buildEmployerInviteContext,
    buildJobSeekerInviteContext,
    runPaddleOcrParser,
    serveSpaStatic,
    assessmentHandler,
    personalizedHandler,
    authHelpers: {
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
    },
  }
}
