import { createServer } from 'node:http'
import { createAssessmentHandler } from './assessment/routes.mjs'
import { createPersonalizedHandler } from './assessment/personalizedRoutes.mjs'
import { randomBytes } from 'node:crypto'
import { hashPassword, verifyPassword } from './authPasswords.mjs'
import { registerAccount, UniqueAccountError } from './authRegister.mjs'
import { validateEmployerSignup, loginRoleMismatchMessage } from './authRoles.mjs'
import { normalizePhone, isValidPhoneInput, findUserByPhone } from './authPhone.mjs'
import {
  evaluateResumeAgainstJd,
  generateVendorAssessmentSheet,
  vendorReportNeedsRefresh,
} from './vendor/aiEvaluation.mjs'
import { config, assertProductionConfig, isProdLike } from './config.mjs'
import {
  loadDb as loadDbFromStore,
  saveDb as persistDb,
  upsertJobRecord,
  saveSessionToken,
  resolveSessionEmail,
  deleteSessionToken,
  pingDatabase,
  appendInterviewHistory,
  emptyDb,
  dbPool,
} from './db/store.mjs'
import {
  smtpConfigured,
  smtpConfigSummary,
  verifySmtpConnection,
  publicAppOrigin,
} from './mail.mjs'
import {
  newInviteToken,
  insertInterviewInvite,
  getInterviewInviteByToken,
  inviteAccessState,
  sendInterviewInviteEmail,
  invitePublicUrl,
  inviteJoinWindowEnd,
  INVITE_JOIN_WINDOW_MINUTES,
  buildInterviewInviteEmail,
  parseInviteContext,
} from './interviewInvites.mjs'
import { sendMail } from './mail.mjs'
import { execFile } from 'node:child_process'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, extname, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': urlPath === '/' ? 'no-cache' : 'public, max-age=3600' })
  if (req.method === 'HEAD') {
    res.end()
    return true
  }
  createReadStream(filePath).pipe(res)
  return true
}
import { provisionEmployerTenant } from './db/saasHelpers.mjs'
import { geminiChat, resolveGeminiApiKey } from './geminiClient.mjs'
import { isGeminiProvider } from './llmModels.mjs'
import {
  upsertCandidateTalent,
  searchCandidateTalent,
  getCandidateTalentById,
  reindexTalentFromDb,
  grantOrganizationTalentAccess,
} from './db/talentIndex.mjs'
import {
  createVendorJob,
  resolvePublicJob,
  parsePublicJobPath,
  listOrgJobs,
  listOpenJobs,
  getOrgJob,
  getOrgApplication,
  createJobApplication,
  listJobApplications,
  updateApplicationInterview,
  publicJobPayload,
} from './vendor/jobs.mjs'
import {
  listJobCandidates,
  listOrganizationCandidates,
} from './vendor/orgCandidates.mjs'
import {
  generateAdaptiveQuestion,
  generateAdaptiveQuestionLocal,
  analyzeInterviewSkillMatch,
  resolveInterviewQuestionMode,
  INTERVIEW_TURN_COUNT,
  generateInterviewTurn,
  getInterviewInteractiveFlowJson,
  processInterviewInteractive,
  llmConfigured,
  publicModelConfig,
  geminiKeyFormatWarning,
  parseResumeWithAI,
  resolveCandidateName,
  scoreInterviewSession,
  summarizeProfile,
} from './interviewAgent.mjs'

assertProductionConfig()

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

const PADDLE_SCRIPT_PATH = [
  new URL('./python/paddle_resume_parser.py', import.meta.url),
  new URL('../python/paddle_resume_parser.py', import.meta.url),
  new URL('./paddle_resume_parser.py', import.meta.url),
].map((u) => fileURLToPath(u)).find((p) => existsSync(p)) || fileURLToPath(new URL('../python/paddle_resume_parser.py', import.meta.url))

async function runPaddleOcrParser(buffer, originalFileName = 'resume.pdf') {
  const ext = extname(originalFileName) || '.pdf'
  const tempPath = join(tmpdir(), `hireright-resume-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
  await writeFile(tempPath, buffer)

  const pythonCmd = process.platform === 'win32' ? 'py' : 'python3'
  const pythonArgs = process.platform === 'win32' ? ['-3.12', PADDLE_SCRIPT_PATH, tempPath] : [PADDLE_SCRIPT_PATH, tempPath]

  return new Promise((resolve) => {
    execFile(pythonCmd, pythonArgs, { maxBuffer: 10 * 1024 * 1024, timeout: 60_000 }, async (err, stdout, stderr) => {
      try {
        await unlink(tempPath)
      } catch {}
      if (err) {
        console.warn('[PaddleOCR] Execution notice:', err.message, stderr)
        return resolve(null)
      }
      try {
        const parsed = JSON.parse(stdout.trim())
        if (parsed && !parsed.error) {
          return resolve(parsed)
        }
      } catch (jsonErr) {
        console.warn('[PaddleOCR] JSON parse notice:', jsonErr.message)
      }
      resolve(null)
    })
  })
}

const PORT = config.port

/** @typedef {{ id: string, name: string, email: string, passwordHash: string, role?: string, companyName?: string, primaryOrganizationId?: string, status?: string, createdAt: string }} User */

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
    db.organizationMembers?.find((m) => m.userId === user.id && m.organizationId === user.primaryOrganizationId) ||
    db.organizationMembers?.find((m) => m.userId === user.id)
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

/** @type {import('node:http').IncomingMessage | null} */
// Associate request-specific headers with the response, avoiding cross-request CORS races.

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
  /** @type {Record<string, string>} */
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
  req.setEncoding('utf8')
  return new Promise((resolve, reject) => {
    let data = ''
    let bytes = 0
    let oversized = false
    req.on('data', (chunk) => {
      bytes += Buffer.byteLength(chunk)
      if (bytes > config.maxBodyBytes) {
        oversized = true
        data = ''
        reject(Object.assign(new Error('Body too large'), { status: 413 }))
        return
      }
      if (!oversized) data += chunk
    })
    req.on('end', () => {
      if (oversized) return
      try {
        const body = data ? JSON.parse(data) : {}
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid JSON object')
        resolve(body)
      } catch {
        reject(Object.assign(new Error('Invalid JSON object'), { status: 400 }))
      }
    })
  })
}

/** Simple in-memory rate limit: email|ip → timestamps */
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

/** Merge stored profile with client payload; resume-aware candidate name wins over demo account. */
function isDemoDisplayName(name) {
  const t = String(name || '').trim()
  return !t || t === 'Arjun Sharma' || /^arjun\s+sharma$/i.test(t)
}

function mergeInterviewProfile(db, email, bodyProfile) {
  const account = email ? db.users.find((u) => u.email === email) : null
  const stored = email ? /** @type {Record<string, unknown>} */ (db.profiles[email] || {}) : {}
  const merged = { ...stored, ...(bodyProfile || {}) }
  const clientName =
    String(bodyProfile?.fullName || bodyProfile?.name || merged.fullName || merged.name || '').trim()
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

const server = createServer(async (req, res) => {
  res.requestOrigin = req.headers.origin
  if (req.method === 'OPTIONS') {
    return json(res, 204, {})
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`)
  const path = url.pathname
  const ip = clientIp(req)

  try {
    if (await assessmentHandler(req, res, url)) return
    if (await personalizedHandler(req, res, url)) return
    // Every confidential vault operation is authenticated and tenant-scoped.
    let vaultTenantId = null
    if (path.startsWith('/api/confidential/')) {
      const email = await requireAuth(req, res)
      if (!email) return
      const user = dbCache.users.find(u => u.email === email && u.status !== 'disabled')
      const tenant = tenantContextForUser(dbCache, user)
      if (user?.role !== 'employer' || tenant.organization?.status !== 'active' ||
          !['owner', 'admin', 'recruiter'].includes(tenant.membership?.role)) {
        return json(res, 403, { error: 'Recruiter organization access required' })
      }
      vaultTenantId = tenant.organization.id
    }
    if (req.method === 'GET' && path === '/api/health') {
      const dbPing = await pingDatabase(config.databaseUrl)
      const deployRef =
        process.env.RENDER_GIT_COMMIT ||
        process.env.VERCEL_GIT_COMMIT_SHA ||
        process.env.GIT_COMMIT ||
        null
      const apiBuildId = process.env.API_BUILD_ID || 'hireright-neon-2026-10-16'
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
        },
      })
    }

    if (req.method === 'GET' && path === '/api/plans') {
      const db = loadDb()
      const plans = (db.subscriptionPlans || []).filter((p) => p.isPublic !== false)
      return json(res, 200, { plans })
    }

    /** Jobs actually posted by employer accounts. No static catalog. */
    if (req.method === 'GET' && path === '/api/jobs') {
      const email = await requireAuth(req, res)
      if (!email) return
      const db = loadDb()
      const jobs = listOpenJobs(db).map((job) => publicJobPayload(job))
      return json(res, 200, { jobs })
    }

    /** Public: resolve shareable job link (no auth) — /api/jobs/public/:code or /api/jobs/public/:companySlug/:code */
    if (req.method === 'GET' && path.startsWith('/api/jobs/public/')) {
      const { code, companySlug, isApply } = parsePublicJobPath(path)
      if (isApply || !code) {
        return json(res, 404, { error: 'Job link not found or expired.' })
      }
      const db = loadDb()
      const job = await resolvePublicJob(db, config.databaseUrl, code, companySlug)
      if (!job) return json(res, 404, { error: 'Job link not found or expired.' })
      return json(res, 200, { job: publicJobPayload(job) })
    }

    /** Public apply: ATS score + application row (optional Bearer for logged-in candidate) */
    if (req.method === 'POST' && path.startsWith('/api/jobs/public/') && path.endsWith('/apply')) {
      const { code, companySlug } = parsePublicJobPath(path)
      const body = await readBody(req)
      const db = loadDb()
      const job = await resolvePublicJob(db, config.databaseUrl, code, companySlug)
      if (!job) return json(res, 404, { error: 'Job link not found or expired.' })
      let candidateUserId = null
      const optionalAuth = await requireAuth(req, res)
      if (!optionalAuth) return
      if (optionalAuth) {
        const u = db.users.find((x) => x.email === optionalAuth)
        if (u?.role === 'employer') {
          return json(res, 403, {
            error:
              'Employer (vendor) accounts cannot apply to jobs as candidates. Sign out and use a candidate account with its own email and phone.',
          })
        }
        candidateUserId = u?.id || null
      }
      const resumeText = String(body.resumeText || '')
      if (resumeText.trim().length < 30 || resumeText.length > 100000) {
        return json(res, 400, { error: 'Upload a readable resume before applying (30–100,000 characters).' })
      }
      const atsEvaluation = await evaluateResumeAgainstJd({
        resumeText,
        jobDescription: job.jobDescription || '',
        requiredSkills: job.requiredSkills || [],
        roleTitle: job.roleTrack,
      })
      const { application, created, ats } = createJobApplication(db, job, {
        ...body,
        candidateEmail: optionalAuth,
        candidateUserId,
        atsEvaluation,
      })
      await saveDb(db)
      if (candidateUserId && config.databaseUrl) {
        void grantOrganizationTalentAccess(
          config.databaseUrl,
          job.organizationId,
          candidateUserId,
          'application',
        ).catch((err) => console.warn('[talent] grant access:', err.message))
      }
      return json(res, created ? 201 : 200, {
        applicationId: application.id,
        job: publicJobPayload(job),
        ats: ats || {
          atsScore: application.data.atsScore,
          jdMatchScore: application.data.jdMatchScore,
          primarySkills: application.data.primarySkills,
          matchedSkills: application.data.matchedSkills,
          missingSkills: application.data.missingSkills,
          strengths: application.data.atsStrengths,
          gaps: application.data.atsGaps,
          summary: application.data.atsSummary,
          aiEnhanced: application.data.aiEnhancedAts,
        },
        organizationId: job.organizationId,
      })
    }

    async function requireEmployerTenant(req, res, db) {
      const authEmail = await requireAuth(req, res)
      if (!authEmail) return null
      const user = db.users.find((u) => u.email === authEmail)
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

    if (req.method === 'POST' && path === '/api/vendor/jobs') {
      const db = loadDb()
      const ctx = await requireEmployerTenant(req, res, db)
      if (!ctx) return
      const body = await readBody(req)
      const job = createVendorJob(db, ctx.tenant.organization.id, ctx.user.id, body)
      await upsertJobRecord(config.databaseUrl, job)
      await saveDb(db)
      return json(res, 201, { job: publicJobPayload(job) })
    }

    if (req.method === 'GET' && path === '/api/vendor/jobs') {
      const db = loadDb()
      const ctx = await requireEmployerTenant(req, res, db)
      if (!ctx) return
      const jobs = listOrgJobs(db, ctx.tenant.organization.id)
      return json(res, 200, { jobs })
    }

    if (req.method === 'GET' && path.startsWith('/api/vendor/jobs/') && path.endsWith('/applicants')) {
      const db = loadDb()
      const ctx = await requireEmployerTenant(req, res, db)
      if (!ctx) return
      const jobId = path.split('/')[4]
      const job = getOrgJob(db, ctx.tenant.organization.id, jobId)
      if (!job) return json(res, 404, { error: 'Job not found.' })
      const applicants = listJobApplications(db, ctx.tenant.organization.id, jobId)
      return json(res, 200, { job, applicants })
    }

    if (req.method === 'GET' && path === '/api/vendor/candidates') {
      const db = loadDb()
      const ctx = await requireEmployerTenant(req, res, db)
      if (!ctx) return
      const orgId = ctx.tenant.organization.id
      const filters = {
        name: url.searchParams.get('name') || '',
        job: url.searchParams.get('job') || '',
        experienceYears:
          url.searchParams.get('experienceYears') || url.searchParams.get('experience') || '',
        keywords: url.searchParams.get('keywords') || url.searchParams.get('q') || '',
        jobId: url.searchParams.get('jobId') || '',
      }
      const roster = await listOrganizationCandidates(db, orgId, config.databaseUrl, filters)
      return json(res, 200, {
        organizationId: orgId,
        ...roster,
      })
    }

    if (
      req.method === 'GET' &&
      /^\/api\/vendor\/jobs\/[^/]+\/candidates$/.test(path)
    ) {
      const db = loadDb()
      const ctx = await requireEmployerTenant(req, res, db)
      if (!ctx) return
      const jobId = path.split('/')[4]
      const job = getOrgJob(db, ctx.tenant.organization.id, jobId)
      if (!job) return json(res, 404, { error: 'Job not found.' })
      const filters = {
        name: url.searchParams.get('name') || '',
        job: url.searchParams.get('job') || '',
        experienceYears:
          url.searchParams.get('experienceYears') || url.searchParams.get('experience') || '',
        keywords: url.searchParams.get('keywords') || url.searchParams.get('q') || '',
      }
      const roster = listJobCandidates(db, ctx.tenant.organization.id, jobId, filters)
      return json(res, 200, { job, organizationId: ctx.tenant.organization.id, ...roster })
    }

    if (req.method === 'GET' && path.startsWith('/api/vendor/applicants/') && path.endsWith('/report')) {
      const db = loadDb()
      const ctx = await requireEmployerTenant(req, res, db)
      if (!ctx) return
      const appId = path.split('/')[4]
      const app = getOrgApplication(db, ctx.tenant.organization.id, appId)
      if (!app) return json(res, 404, { error: 'Applicant not found.' })
      const job = getOrgJob(db, ctx.tenant.organization.id, app.jobId)
      const forceRefresh = url.searchParams.get('refresh') === '1'
      if (!vendorReportNeedsRefresh(app.data, forceRefresh) && app.data?.vendorReport) {
        return json(res, 200, { report: app.data.vendorReport, application: app })
      }
      const report = await generateVendorAssessmentSheet({
        candidateName: app.data.candidateName || app.candidateEmail,
        jobTitle: job?.title || app.data.jobTitle,
        company: job?.company || app.data.company,
        jobDescription: job?.jobDescription || '',
        resumeText: app.data.resumeText || '',
        atsEvaluation: {
          atsScore: app.data.atsScore,
          jdMatchScore: app.data.jdMatchScore,
          primarySkills: app.data.primarySkills,
          matchedSkills: app.data.matchedSkills,
          missingSkills: app.data.missingSkills,
          strengths: app.data.atsStrengths,
          gaps: app.data.atsGaps,
          summary: app.data.atsSummary,
        },
        interviewResult: app.data.interviewResult,
      })
      app.data.vendorReport = report
      await saveDb(db)
      return json(res, 200, { report, application: app })
    }

    if (req.method === 'GET' && /^\/api\/vendor\/applicants\/[^/]+\/interview-plan$/.test(path)) {
      const db = loadDb()
      const ctx = await requireEmployerTenant(req, res, db)
      if (!ctx) return
      const appId = path.split('/')[4]
      const app = getOrgApplication(db, ctx.tenant.organization.id, appId)
      if (!app) return json(res, 404, { error: 'Applicant not found.' })
      const job = getOrgJob(db, ctx.tenant.organization.id, app.jobId)
      const jobDescription = String(job?.jobDescription || '')
      const requiredSkills = job?.requiredSkills || app.data?.primarySkills || []
      const profile = {
        resumeText: app.data?.resumeText || '',
        workExperiences: app.data?.workExperiences || [],
        skills: app.data?.skills || [],
        experienceYears: app.data?.experienceYears || '',
      }
      const digest = summarizeProfile(profile, app.data?.candidateName || app.candidateEmail)
      const skillAnalysis = analyzeInterviewSkillMatch({
        jobDescription,
        requiredSkills,
        profile,
        ctx: digest,
      })
      const role = job?.roleTrack || job?.title || app.data?.jobTitle || 'Engineer'
      const level = app.data?.experienceYears || job?.experienceLevel || '1–3 years'
      const questions = []
      const history = []
      for (let turn = 0; turn < INTERVIEW_TURN_COUNT; turn++) {
        const question = generateAdaptiveQuestionLocal({
          ctx: digest,
          role,
          level,
          jobDescription,
          history,
          lastAnswer: '',
        })
        questions.push(question)
        history.push({ question, answer: '' })
      }
      return json(res, 200, {
        questionMode: 'adaptive',
        role,
        level,
        skillAnalysis,
        questions: questions.map((q) => ({
          text: q.text,
          category: q.category,
          topic: q.topic,
        })),
      })
    }

    if (req.method === 'POST' && /^\/api\/vendor\/applicants\/[^/]+\/interview-invite$/.test(path)) {
      const db = loadDb()
      const ctx = await requireEmployerTenant(req, res, db)
      if (!ctx) return
      const appId = path.split('/')[4]
      const body = await readBody(req)
      const app = getOrgApplication(db, ctx.tenant.organization.id, appId)
      if (!app) return json(res, 404, { error: 'Applicant not found.' })
      const job = getOrgJob(db, ctx.tenant.organization.id, app.jobId)
      const scheduledStartRaw = body.scheduledStart || body.scheduledAt
      const start = new Date(scheduledStartRaw)
      if (Number.isNaN(start.getTime())) {
        return json(res, 400, { error: 'scheduledStart (ISO datetime) is required.' })
      }
      const durationMin = Math.min(180, Math.max(15, Number(body.durationMinutes || 60)))
      const end = inviteJoinWindowEnd(start)
      const token = newInviteToken()
      const contextJson = {
        ...buildEmployerInviteContext(db, app, job),
        interviewDurationMinutes: durationMin,
        joinWindowMinutes: INVITE_JOIN_WINDOW_MINUTES,
      }
      const pool = dbPool(config.databaseUrl)
      await insertInterviewInvite(pool, {
        token,
        organizationId: ctx.tenant.organization.id,
        applicationId: app.id,
        jobId: app.jobId,
        candidateEmail: app.candidateEmail,
        candidateName: app.data?.candidateName || '',
        jobTitle: job?.title || app.data?.jobTitle || '',
        scheduledStart: start.toISOString(),
        scheduledEnd: end.toISOString(),
        createdByUserId: ctx.user.id,
        contextJson,
      })
      const inviteUrl = invitePublicUrl(token)
      let emailSent = false
      let emailError = null
      if (smtpConfigured()) {
        try {
          await sendInterviewInviteEmail({
            to: app.candidateEmail,
            candidateName: app.data?.candidateName,
            jobTitle: job?.title,
            scheduledStart: start.toISOString(),
            inviteUrl,
          })
          await pool.query(
            'UPDATE interview_invites SET email_sent_at = NOW() WHERE token = $1',
            [token],
          )
          emailSent = true
        } catch (err) {
          emailError = err instanceof Error ? err.message : 'Email failed'
        }
      }
      app.data = app.data || {}
      app.data.lastInterviewInvite = {
        token,
        inviteUrl,
        scheduledStart: start.toISOString(),
        scheduledEnd: end.toISOString(),
        emailSent,
      }
      await saveDb(db)
      return json(res, 201, {
        invite: {
          token,
          inviteUrl,
          scheduledStart: start.toISOString(),
          scheduledEnd: end.toISOString(),
          emailSent,
          emailError,
          smtpConfigured: smtpConfigured(),
        },
      })
    }

    if (req.method === 'PATCH' && path.startsWith('/api/vendor/applicants/')) {
      const db = loadDb()
      const ctx = await requireEmployerTenant(req, res, db)
      if (!ctx) return
      const appId = path.replace('/api/vendor/applicants/', '').split('/')[0]
      const body = await readBody(req)
      const app = (db.employerApplications || []).find(
        (a) => a.id === appId && a.organizationId === ctx.tenant.organization.id,
      )
      if (!app) return json(res, 404, { error: 'Applicant not found.' })
      if (body.status) app.status = String(body.status)
      await saveDb(db)
      return json(res, 200, { application: app })
    }

    if (req.method === 'GET' && path.startsWith('/api/interview-invites/')) {
      const token = path.replace('/api/interview-invites/', '').trim()
      if (!token) return json(res, 400, { error: 'Invite token required.' })
      const pool = dbPool(config.databaseUrl)
      const row = await getInterviewInviteByToken(pool, token)
      if (!row) return json(res, 404, { error: 'Invite not found.' })
      const access = inviteAccessState(row)
      const db = loadDb()
      const orgId = row.organization_id
      const job = orgId && row.job_id ? getOrgJob(db, orgId, row.job_id) : null
      const app =
        orgId && row.application_id ? getOrgApplication(db, orgId, row.application_id) : null
      const ctx = parseInviteContext(row)
      const resumeText =
        ctx.resumeText || app?.data?.resumeText || db.profiles?.[row.candidate_email]?.resumeText || ''
      const jobDescription =
        ctx.jobDescription || job?.jobDescription || app?.data?.jobDescription || ''
      return json(res, 200, {
        invite: {
          token: row.token,
          candidateEmail: row.candidate_email,
          candidateName: row.candidate_name,
          jobTitle: row.job_title || job?.title || ctx.jobTitle,
          scheduledStart: row.scheduled_start,
          scheduledEnd: row.scheduled_end,
          applicationId: row.application_id || null,
          jobId: row.job_id || null,
          organizationId: orgId || null,
          jobDescription,
          resumeText,
          resumeName: ctx.resumeName || app?.data?.resumeName || null,
          roleTrack: ctx.roleTrack || job?.roleTrack || '',
          experienceLevel: ctx.experienceLevel || job?.experienceLevel || '',
          company: job?.company || '',
          primarySkills: ctx.primarySkills || app?.data?.primarySkills || job?.requiredSkills || [],
          atsScore: app?.data?.atsScore ?? null,
          jdMatchScore: app?.data?.jdMatchScore ?? null,
          contextSource: ctx.source || null,
          ...access,
          interviewPath: `/interview/invite/${row.token}`,
        },
      })
    }

    if (req.method === 'POST' && path === '/api/interview/confirmation-email') {
      const email = await requireAuth(req, res)
      if (!email) return
      const body = await readBody(req)
      const scheduledStart = body.scheduledStart || body.scheduledAt
      const start = scheduledStart ? new Date(scheduledStart) : null
      if (!start || Number.isNaN(start.getTime())) {
        return json(res, 400, { error: 'scheduledStart is required.' })
      }
      if (!smtpConfigured()) {
        return json(res, 503, { error: 'SMTP not configured on server.', smtpConfigured: false })
      }
      const db = loadDb()
      const user = db.users.find((u) => u.email === email)
      const durationMin = Math.min(180, Math.max(15, Number(body.durationMinutes || 60)))
      const end = inviteJoinWindowEnd(start)
      const token = newInviteToken()
      const orgId =
        user?.primaryOrganizationId ||
        db.organizationMembers?.find((m) => m.userId === user?.id)?.organizationId ||
        null
      const contextJson = {
        ...buildJobSeekerInviteContext(db, email, body),
        interviewDurationMinutes: durationMin,
        joinWindowMinutes: INVITE_JOIN_WINDOW_MINUTES,
      }
      const pool = dbPool(config.databaseUrl)
      await insertInterviewInvite(pool, {
        token,
        organizationId: orgId,
        candidateEmail: email,
        candidateName: user?.name || '',
        jobTitle: body.jobTitle || contextJson.jobTitle || 'AI Interview',
        scheduledStart: start.toISOString(),
        scheduledEnd: end.toISOString(),
        createdByUserId: user?.id,
        contextJson,
      })
      const inviteUrl = invitePublicUrl(token)
      const { subject, html, text } = buildInterviewInviteEmail({
        candidateName: user?.name,
        jobTitle: body.jobTitle || contextJson.jobTitle,
        scheduledStart: start.toISOString(),
        inviteUrl,
      })
      await sendMail({ to: email, subject, html, text })
      await pool.query('UPDATE interview_invites SET email_sent_at = NOW() WHERE token = $1', [token])
      return json(res, 200, {
        ok: true,
        inviteUrl,
        emailSent: true,
        token,
        scheduledStart: start.toISOString(),
        scheduledEnd: end.toISOString(),
        smtpConfigured: true,
      })
    }

    if (req.method === 'GET' && path === '/api/mail/status') {
      const wantVerify = new URL(req.url || '/', 'http://localhost').searchParams.get('verify') === '1'
      let verify = null
      if (wantVerify && smtpConfigured()) {
        try {
          await verifySmtpConnection()
          verify = { ok: true }
        } catch (err) {
          verify = { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      } else if (wantVerify && !smtpConfigured()) {
        verify = { ok: false, error: 'SMTP_PASS or other SMTP vars missing' }
      }
      const summary = smtpConfigSummary()
      return json(res, 200, {
        smtpConfigured: smtpConfigured(),
        smtpHost: summary.host,
        smtpUser: summary.user,
        smtpFrom: summary.from,
        smtpPassSet: summary.passSet,
        publicAppUrl: publicAppOrigin(),
        inviteJoinWindowMinutes: INVITE_JOIN_WINDOW_MINUTES,
        verify,
      })
    }

    if (req.method === 'GET' && path === '/api/organization') {
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
    }

    if (req.method === 'GET' && path === '/api/llm-status') {
      const apiKey = resolveGeminiApiKey()
      if (!apiKey) {
        return json(res, 200, {
          active: false,
          configured: false,
          provider: 'Built-in Local Agent',
          message: 'No LLM API key set. Running in local agent mode.',
        })
      }

      const isGemini = isGeminiProvider()
      const models = publicModelConfig()
      const providerName = 'HireRight AI'

      try {
        if (isGemini) {
          const { modelCascadeForTier } = await import('./llmModels.mjs')
          let ping = null
          let model = models.fast || models.quality
          for (const candidate of modelCascadeForTier('fast')) {
            model = candidate.name
            ping = await geminiChat({
              apiKey,
              model,
              user: 'Ping',
              temperature: 0,
              maxTokens: 5,
            })
            if (ping.ok) break
          }
          if (ping?.ok) {
            return json(res, 200, {
              active: true,
              configured: true,
              provider: providerName,
              model: 'hireright-ai',
              statusCode: ping.status,
              authMode: apiKey.startsWith('AQ.') ? 'gemini-auth-key-native' : 'gemini-openai-compatible',
              message: 'Ava AI interview is ready.',
              models,
            })
          }
          return json(res, 200, {
            active: false,
            configured: true,
            provider: providerName,
            model: 'hireright-ai',
            statusCode: ping.status,
            message: 'Ava AI interview · using built-in question engine.',
          })
        }

        const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
        const pingRes = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'HTTP-Referer': 'http://localhost:5173',
            'X-Title': 'HIRERIGHTTT',
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: 'Ping' }],
            max_tokens: 5,
          }),
        })
        if (pingRes.ok) {
          return json(res, 200, {
            active: true,
            configured: true,
            provider: providerName,
            model: 'hireright-ai',
            statusCode: pingRes.status,
            message: 'Ava AI interview is ready.',
            models,
          })
        }
        return json(res, 200, {
          active: false,
          configured: true,
          provider: providerName,
          model: 'hireright-ai',
          statusCode: pingRes.status,
          message: 'Ava AI interview · using built-in question engine.',
        })
      } catch {
        return json(res, 200, {
          active: false,
          configured: true,
          provider: providerName,
          model: 'hireright-ai',
          message: 'Ava AI interview · using built-in question engine.',
        })
      }
    }

    if (req.method === 'POST' && path === '/api/signup') {
      if (!config.signupEnabled) {
        return json(res, 403, { error: 'Sign-up is disabled on this deployment.' })
      }
      if (!rateLimit(`signup:${ip}`, 8)) {
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
        dbCache = await loadDbFromStore(config.databaseUrl)
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
    }

    if (req.method === 'POST' && path === '/api/login') {
      if (!rateLimit(`login:${ip}`, 20)) {
        return json(res, 429, { error: 'Too many login attempts. Try again shortly.' })
      }
      const body = await readBody(req)
      const email = String(body.email || '').trim().toLowerCase()
      const password = String(body.password || '')
      const db = loadDb()
      const user = db.users.find((u) => u.email === email)
      if (!user || user.status !== 'active' || !await verifyPassword(password, user.passwordHash)) {
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
    }

    if (req.method === 'POST' && path === '/api/logout') {
      const header = req.headers.authorization || ''
      const token = header.replace(/^Bearer\s+/i, '')
      await deleteSessionToken(config.databaseUrl, token)
      return json(res, 200, { ok: true })
    }

    if (req.method === 'GET' && path === '/api/me') {
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
    }

    if (req.method === 'PUT' && path === '/api/profile') {
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
        void upsertCandidateTalent(
          config.databaseUrl,
          account,
          db.profiles[email],
          db.interviews[email],
        ).catch((err) => console.warn('[talent] profile index:', err.message))
      }
      return json(res, 200, { profile: db.profiles[email] })
    }

    /** Employer / vendor: search job seekers (Neon FTS + filters) */
    if (req.method === 'GET' && path === '/api/talent/search') {
      const email = await requireAuth(req, res)
      if (!email) return
      const db = loadDb()
      const user = db.users.find((u) => u.email === email)
      if (!user || user.role !== 'employer') {
        return json(res, 403, { error: 'Employer account required for talent search.' })
      }
      const tenant = tenantContextForUser(db, user)
      if (!tenant.organization?.id) {
        return json(res, 403, { error: 'No organization linked to this employer account.' })
      }
      const skillsParam = String(url.searchParams.get('skills') || '')
      const skills = skillsParam
        ? skillsParam.split(',').map((s) => s.trim()).filter(Boolean)
        : []
      const minScoreRaw = url.searchParams.get('minScore')
      const minScore = minScoreRaw ? Number(minScoreRaw) : undefined
      try {
        const result = await searchCandidateTalent(config.databaseUrl, tenant.organization.id, {
          q: url.searchParams.get('q') || '',
          location: url.searchParams.get('location') || '',
          experienceYears: url.searchParams.get('experienceYears') || url.searchParams.get('experience') || '',
          skills,
          minScore: Number.isFinite(minScore) ? minScore : undefined,
          limit: Number(url.searchParams.get('limit') || 25),
          offset: Number(url.searchParams.get('offset') || 0),
        })
        return json(res, 200, result)
      } catch (err) {
        return json(res, 500, {
          error: err instanceof Error ? err.message : 'Talent search failed.',
        })
      }
    }

    if (req.method === 'GET' && path.startsWith('/api/talent/candidates/')) {
      const email = await requireAuth(req, res)
      if (!email) return
      const db = loadDb()
      const user = db.users.find((u) => u.email === email)
      if (!user || user.role !== 'employer') {
        return json(res, 403, { error: 'Employer account required.' })
      }
      const tenant = tenantContextForUser(db, user)
      if (!tenant.organization?.id) {
        return json(res, 403, { error: 'No organization linked to this employer account.' })
      }
      const userId = path.replace('/api/talent/candidates/', '').split('/')[0]
      try {
        const candidate = await getCandidateTalentById(
          config.databaseUrl,
          tenant.organization.id,
          userId,
        )
        if (!candidate) return json(res, 404, { error: 'Candidate not found or not visible.' })
        const interview = db.interviews[candidate.email] || null
        return json(res, 200, { candidate, interview })
      } catch (err) {
        return json(res, 500, {
          error: err instanceof Error ? err.message : 'Could not load candidate.',
        })
      }
    }

    /** Start Ava interview: resume-aware dynamic questions (Bearer token required) */
    if (req.method === 'POST' && path === '/api/interview/start') {
      const email = await requireAuth(req, res)
      if (!email) return
      if (!rateLimit(`ivstart:${email}`, 12)) {
        return json(res, 429, { error: 'Interview start rate limited. Wait a minute.' })
      }
      const body = await readBody(req)
      const role = String(body.role || 'Full Stack Engineer')
      const level = String(body.level || '1–3 years')
      const jobDescription = String(body.jobDescription || '')
      const db = loadDb()
      const profile = mergeInterviewProfile(db, email, body.profile)
      const account = db.users.find((u) => u.email === email)

      const ctx = summarizeProfile(profile, account?.name)
      const explicitRoleTrack = body.explicitRoleTrack === true
      const questionModeHint = String(body.questionMode || '').trim()
      const jobRecord = body.jobId
        ? (db.jobs || []).find((j) => j.id === String(body.jobId))
        : null
      const requiredSkills =
        Array.isArray(body.primarySkills) && body.primarySkills.length
          ? body.primarySkills.map(String)
          : jobRecord?.requiredSkills || []

      const questionMode = resolveInterviewQuestionMode({
        mode: questionModeHint || undefined,
        applicationId: body.applicationId,
        jobId: body.jobId,
        jobDescription: jobDescription || jobRecord?.jobDescription || '',
        requiredSkills,
      })
      const effectiveJd = jobDescription || jobRecord?.jobDescription || ''
      let skillAnalysis = null
      if (questionMode === 'employer' || questionMode === 'individual_jd') {
        skillAnalysis = analyzeInterviewSkillMatch({
          jobDescription: effectiveJd,
          requiredSkills,
          profile,
          ctx,
        })
      }

      const first = await generateAdaptiveQuestion({
        ctx,
        profile,
        role,
        level,
        jobDescription: effectiveJd,
        explicitRoleTrack,
        history: [],
        lastAnswer: '',
        accountName: account?.name,
      })
      const questions = [first]
      const agentLabel = first.focus === 'adaptive-llm' ? 'llm-adaptive' : 'adaptive-local'
      const adaptive = true

      const sessionId = randomBytes(12).toString('hex')
      const session = {
        id: sessionId,
        email,
        role,
        level,
        mode: adaptive ? 'adaptive' : 'fixed',
        questions,
        history: [],
        answers: [],
        agent: agentLabel,
        context: ctx,
        jobDescription: effectiveJd,
        explicitRoleTrack,
        jobId: body.jobId ? String(body.jobId) : null,
        applicationId: body.applicationId ? String(body.applicationId) : null,
        organizationId: (() => {
          const fromBody = body.organizationId ? String(body.organizationId) : ''
          if (fromBody) return fromBody
          if (!body.applicationId) return null
          const linked = (db.employerApplications || []).find(
            (a) => a.id === String(body.applicationId),
          )
          return linked?.organizationId ? String(linked.organizationId) : null
        })(),
        primarySkills: skillAnalysis?.jdSkills || requiredSkills,
        questionMode,
        skillAnalysis,
        atsScore:
          typeof body.atsScore === 'number'
            ? body.atsScore
            : skillAnalysis?.atsScore ?? null,
        jdMatchScore:
          typeof body.jdMatchScore === 'number'
            ? body.jdMatchScore
            : skillAnalysis?.jdMatchScore ?? null,
        integrity: {
          faceViolations: 0,
          singlePersonOk: true,
          maxFacesSeen: 1,
        },
        startedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        status: 'active',
      }
      db.interviewSessions[sessionId] = session
      await saveDb(db)

      return json(res, 200, {
        sessionId,
        agent: agentLabel,
        adaptive,
        llm: llmConfigured(),
        total: adaptive ? INTERVIEW_TURN_COUNT : questions.length,
        questionIndex: 0,
        question: questions[0],
        questions,
        profileDigest: ctx,
        questionMode,
        skillAnalysis: skillAnalysis
          ? {
              jdSkills: skillAnalysis.jdSkills,
              matchedSkills: skillAnalysis.matchedSkills,
              missingSkills: skillAnalysis.missingSkills,
              atsScore: skillAnalysis.atsScore,
              jdMatchScore: skillAnalysis.jdMatchScore,
            }
          : null,
      })
    }

    /** Next adaptive question (dynamic — no fixed bank) */
    if (req.method === 'POST' && path === '/api/interview/next') {
      const email = await requireAuth(req, res)
      if (!email) return
      if (!rateLimit(`ivnext:${email}`, 30)) {
        return json(res, 429, { error: 'Next-question rate limited.' })
      }
      const body = await readBody(req)
      const db = loadDb()
      const sessionId = String(body.sessionId || '')
      const session = sessionId ? /** @type {any} */ (db.interviewSessions[sessionId]) : null
      if (!session || session.email !== email) {
        return json(res, 404, { error: 'Interview session not found.' })
      }
      const profile = mergeInterviewProfile(db, email, body.profile)
      const account = db.users.find((u) => u.email === email)
      const ctx = summarizeProfile(profile, account?.name)
      const history = mergeTurnIntoInterviewHistory(
        Array.isArray(body.history) ? body.history : session.history || [],
        body.lastQuestion,
        body.lastAnswer,
      )
      session.history = history
      const lastAnswer = String(body.lastAnswer || '')
      const nextJobDescription = String(body.jobDescription || session.jobDescription || '')
      const explicitRoleTrack =
        body.explicitRoleTrack === true || session.explicitRoleTrack === true
      const next = await generateAdaptiveQuestion({
        ctx,
        profile,
        role: String(body.role || session.role),
        level: String(body.level || session.level),
        jobDescription: nextJobDescription,
        explicitRoleTrack,
        history,
        lastAnswer,
        accountName: account?.name,
      })
      session.questions = [...(session.questions || []), next]
      db.interviewSessions[sessionId] = session
      await saveDb(db)
      return json(res, 200, { question: next, turn: history.length + 1 })
    }

    /** Interactive turn: Ava acknowledges answer before next question */
    if (req.method === 'POST' && path === '/api/interview/turn') {
      const email = await requireAuth(req, res)
      if (!email) return
      if (!rateLimit(`ivturn:${email}`, 40)) {
        return json(res, 429, { error: 'Turn rate limited.' })
      }
      const body = await readBody(req)
      const db = loadDb()
      const profile = mergeInterviewProfile(db, email, body.profile)
      const ctx = summarizeProfile(profile, db.users.find((u) => u.email === email)?.name)
      const turn = await generateInterviewTurn({
        ctx,
        profile,
        role: String(body.role || 'Full Stack Engineer'),
        level: String(body.level || '1–3 years'),
        question: body.question || {},
        answer: String(body.answer || ''),
        questionIndex: Number(body.questionIndex ?? 0),
        totalQuestions: Number(body.totalQuestions ?? 0),
        nextQuestion: body.nextQuestion || {},
      })
      return json(res, 200, turn)
    }

    /** Interactive prelude + command actions (JSON flow: welcome → confirm → questions) */
    if (req.method === 'GET' && path === '/api/interview/flow') {
      return json(res, 200, { flow: getInterviewInteractiveFlowJson() })
    }

    if (req.method === 'POST' && path === '/api/interview/interact') {
      const email = await requireAuth(req, res)
      if (!email) return
      if (!rateLimit(`ivinteract:${email}`, 60)) {
        return json(res, 429, { error: 'Interactive turn rate limited.' })
      }
      const body = await readBody(req)
      const db = loadDb()
      const profile = mergeInterviewProfile(db, email, body.profile)
      const account = db.users.find((u) => u.email === email)
      const ctx = summarizeProfile(profile, account?.name)
      const result = processInterviewInteractive({
        phase: String(body.phase || 'day_check'),
        userText: String(body.userText || ''),
        role: String(body.role || 'Full Stack Engineer'),
        profile,
        accountName: account?.name,
        ctx,
      })
      return json(res, 200, result)
    }

    /** PaddleOCR Resume Parsing */
    if (req.method === 'POST' && path === '/api/resume/parse') {
      if (isProdLike) {
        const email = await requireAuth(req, res)
        if (!email) return
        if (!rateLimit(`resume:${email}`, 25, 60_000)) {
          return json(res, 429, { error: 'Too many resume parse requests. Try again shortly.' })
        }
      } else if (!rateLimit(`resume:${ip}`, 30, 60_000)) {
        return json(res, 429, { error: 'Too many resume parse requests. Try again shortly.' })
      }
      const body = await readBody(req)
      const fileData = body.fileData || body.fileBase64
      const fileName = String(body.fileName || 'resume.pdf')
      const text = String(body.text || body.resumeText || '')

      let paddleExtract = null
      if (fileData) {
        try {
          const base64Content = fileData.includes(',') ? fileData.split(',')[1] : fileData
          const buffer = Buffer.from(base64Content, 'base64')
          paddleExtract = await runPaddleOcrParser(buffer, fileName)
        } catch (e) {
          console.warn('[PaddleOCR] Buffer decode notice:', e.message)
        }
      } else if (text.trim()) {
        try {
          const buffer = Buffer.from(text, 'utf-8')
          paddleExtract = await runPaddleOcrParser(buffer, 'resume.txt')
        } catch (e) {
          console.warn('[PaddleOCR] Text buffer notice:', e.message)
        }
      }

      if (paddleExtract) {
        return json(res, 200, { ok: true, source: 'paddle-ocr', extract: paddleExtract })
      }

      // Secondary fallback if PaddleOCR did not return output
      if (text.trim()) {
        try {
          const parsed = await parseResumeWithAI(text)
          if (parsed) {
            return json(res, 200, { ok: true, source: 'gemini-2.5-flash', extract: parsed })
          }
        } catch (err) {
          console.warn('Backend fallback resume parse error:', err)
        }
      }

      return json(res, 400, { ok: false, error: 'Could not extract fields from resume.' })
    }

    /** Record integrity ping (face count) during interview */
    if (req.method === 'POST' && path === '/api/interview/integrity') {
      const email = await requireAuth(req, res)
      if (!email) return
      const body = await readBody(req)
      const sessionId = String(body.sessionId || '')
      const db = loadDb()
      const session = /** @type {any} */ (db.interviewSessions[sessionId])
      if (!session || session.email !== email) {
        return json(res, 404, { error: 'Interview session not found.' })
      }
      const faceCount = Number(body.faceCount ?? 1)
      session.integrity = session.integrity || {
        faceViolations: 0,
        singlePersonOk: true,
        maxFacesSeen: 1,
      }
      session.integrity.maxFacesSeen = Math.max(session.integrity.maxFacesSeen || 1, faceCount)
      if (faceCount !== 1) {
        session.integrity.faceViolations = (session.integrity.faceViolations || 0) + 1
        session.integrity.singlePersonOk = false
      }
      db.interviewSessions[sessionId] = session
      await saveDb(db)
      return json(res, 200, { integrity: session.integrity })
    }

    /** Score full interview (client sends answers + optional live integrity) */
    if (req.method === 'POST' && path === '/api/interview/score') {
      const email = await requireAuth(req, res)
      if (!email) return
      if (!rateLimit(`ivscore:${email}`, 10)) {
        return json(res, 429, { error: 'Score rate limited.' })
      }
      const body = await readBody(req)
      const db = loadDb()
      const sessionId = String(body.sessionId || '')
      const session = sessionId ? /** @type {any} */ (db.interviewSessions[sessionId]) : null
      if (!session || session.email !== email) {
        return json(res, 404, { error: 'Interview session not found.' })
      }

      const profile = mergeInterviewProfile(db, email, body.profile)

      const rawQuestions = body.questions || session?.questions
      const answers = Array.isArray(body.answers) ? body.answers.map(String) : []
      const role = String(body.role || session?.role || 'Full Stack Engineer')
      const level = String(body.level || session?.level || '1–3 years')

      const questions = (Array.isArray(rawQuestions) ? rawQuestions : []).map((q) => {
        if (q && typeof q === 'object' && q.text) return q
        if (typeof q === 'string') {
          return { text: q, category: 'Technical', keywords: [], hint: '' }
        }
        return null
      }).filter(Boolean)

      if (!questions.length) {
        return json(res, 400, { error: 'Questions required to score interview.' })
      }

      const pairCount = Math.min(
        questions.length,
        answers.length,
        answers.filter((a) => String(a || '').trim()).length || answers.length,
      )
      const scoredQuestions = questions.slice(0, pairCount)
      const scoredAnswers = answers.slice(0, pairCount)
      if (!pairCount) {
        return json(res, 400, { error: 'At least one answer is required to score the interview.' })
      }

      const integrity = {
        ...(session?.integrity || {}),
        ...(body.integrity || {}),
      }

      const startedAt = session?.startedAt ? new Date(session.startedAt).getTime() : Date.now()
      const durationMinutes = Math.max(1, Math.round((Date.now() - startedAt) / 60000))

      const result = await scoreInterviewSession({
        role,
        level,
        questions: scoredQuestions,
        answers: scoredAnswers,
        profile,
        integrity,
        accountName: db.users.find((u) => u.email === email)?.name,
        durationMinutes,
      })

      db.interviews[email] = result
      if (session) {
        session.status = 'completed'
        session.answers = scoredAnswers
        session.questions = scoredQuestions
        session.result = result
        session.completedAt = new Date().toISOString()
        db.interviewSessions[sessionId] = session
      }
      await saveDb(db)
      const scoredUser = db.users.find((u) => u.email === email)
      const applicationId = String(session?.applicationId || '')
      let organizationId = String(session?.organizationId || '')
      if (applicationId && !organizationId) {
        const linked = (db.employerApplications || []).find((a) => a.id === applicationId)
        if (linked?.organizationId) organizationId = String(linked.organizationId)
      }
      if (applicationId && organizationId) {
        const app = getOrgApplication(db, organizationId, applicationId)
        if (!app || app.candidateEmail !== email || (app.candidateUserId && app.candidateUserId !== scoredUser?.id)) {
          return json(res, 403, { error: 'This application does not belong to your account.' })
        }
        const job = app ? getOrgJob(db, organizationId, app.jobId) : null
        let vendorReport = null
        if (app) {
          vendorReport = await generateVendorAssessmentSheet({
            candidateName: app.data.candidateName || email,
            jobTitle: job?.title || app.data.jobTitle,
            company: job?.company || app.data.company,
            jobDescription: job?.jobDescription || session?.jobDescription || body.jobDescription || '',
            resumeText: app.data.resumeText || String(db.profiles[email]?.resumeText || ''),
            atsEvaluation: {
              atsScore: app.data.atsScore ?? session?.atsScore,
              jdMatchScore: app.data.jdMatchScore ?? session?.jdMatchScore,
              primarySkills: app.data.primarySkills,
              matchedSkills: app.data.matchedSkills,
              missingSkills: app.data.missingSkills,
              strengths: app.data.atsStrengths,
              gaps: app.data.atsGaps,
              summary: app.data.atsSummary,
            },
            interviewResult: result,
          })
        }
        updateApplicationInterview(db, applicationId, organizationId, result, {
          atsScore: session?.atsScore ?? app?.data?.atsScore ?? null,
          jdMatchScore: session?.jdMatchScore ?? app?.data?.jdMatchScore ?? null,
          vendorReport,
        })
        await saveDb(db)
      }
      if (scoredUser && config.databaseUrl) {
        void upsertCandidateTalent(
          config.databaseUrl,
          scoredUser,
          db.profiles[email] || {},
          result,
        ).catch((err) => console.warn('[talent] score index:', err.message))
        if (session?.organizationId && scoredUser.id) {
          void grantOrganizationTalentAccess(
            config.databaseUrl,
            session.organizationId,
            scoredUser.id,
            'interview',
          ).catch((err) => console.warn('[talent] grant access:', err.message))
        }
      }
      void appendInterviewHistory(config.databaseUrl, email, result, {
        userId: scoredUser?.id,
        organizationId: session?.organizationId || scoredUser?.primaryOrganizationId || null,
        jobId: session?.jobId || null,
      }).catch((err) => {
        console.warn('[db] interview history append failed:', err.message)
      })
      return json(res, 200, { interview: result })
    }

    if (req.method === 'POST' && path === '/api/interview') {
      const email = await requireAuth(req, res)
      if (!email) return
      const body = await readBody(req)
      const db = loadDb()
      db.interviews[email] = body
      await saveDb(db)
      return json(res, 200, { interview: body })
    }

    if (req.method === 'POST' && path === '/api/applications') {
      const email = await requireAuth(req, res)
      if (!email) return
      const body = await readBody(req)
      const db = loadDb()
      const list = db.applications[email] || []
      list.unshift({
        ...body,
        id: randomBytes(6).toString('hex'),
        appliedAt: new Date().toISOString(),
      })
      db.applications[email] = list
      await saveDb(db)
      return json(res, 201, { applications: list })
    }

    /* -------------------------------------------------------------
     * CONFIDENTIAL TALENT & RESUME VAULT APIS
     * ------------------------------------------------------------- */

    /** Get all confidential candidates (supports ?q= and ?status=) */
    if (req.method === 'GET' && path === '/api/confidential/candidates') {
      const db = loadDb()
      const q = String(url.searchParams.get('q') || '').toLowerCase().trim()
      const status = String(url.searchParams.get('status') || 'All')

      let list = (db.confidentialVault || []).filter(c => c.organizationId === vaultTenantId)
      if (q) {
        list = list.filter(
          (c) =>
            c.name?.toLowerCase().includes(q) ||
            c.email?.toLowerCase().includes(q) ||
            c.currentRole?.toLowerCase().includes(q) ||
            c.location?.toLowerCase().includes(q) ||
            (c.skills && c.skills.some((s) => s.toLowerCase().includes(q))) ||
            c.resumeText?.toLowerCase().includes(q),
        )
      }
      if (status && status !== 'All') {
        list = list.filter((c) => c.status === status)
      }
      return json(res, 200, {
        total: list.length,
        candidates: list,
      })
    }

    /** Add / Ingest a candidate directly into the confidential vault */
    if (req.method === 'POST' && path === '/api/confidential/candidates') {
      const body = await readBody(req)
      if (!body.name && !body.email) {
        return json(res, 400, { error: 'Candidate name or email is required.' })
      }
      const db = loadDb()
      if (!db.confidentialVault) db.confidentialVault = []

      const candidate = {
        id: `conf-${randomBytes(6).toString('hex')}`,
        organizationId: vaultTenantId,
        name: String(body.name || 'Anonymous Candidate'),
        email: String(body.email || `candidate_${Date.now()}@confidential.io`),
        phone: String(body.phone || ''),
        currentRole: String(body.currentRole || ''),
        experienceYears: String(body.experienceYears || ''),
        location: String(body.location || ''),
        skills: Array.isArray(body.skills) ? body.skills : [],
        resumeName: String(body.resumeName || 'candidate_resume.pdf'),
        resumeText: String(body.resumeText || ''),
        summary: String(body.summary || body.resumeText?.slice(0, 160) || ''),
        interviewScore: typeof body.interviewScore === 'number' ? body.interviewScore : undefined,
        interviewResult: body.interviewResult || undefined,
        status: body.status || 'New',
        source: String(body.source || 'Confidential Ingestion API'),
        createdAt: new Date().toISOString(),
      }

      db.confidentialVault.unshift(candidate)
      await saveDb(db)
      return json(res, 201, { success: true, candidate })
    }

    /** Get single candidate by ID */
    if (req.method === 'GET' && path.startsWith('/api/confidential/candidates/')) {
      const id = path.replace('/api/confidential/candidates/', '')
      const db = loadDb()
      const item = (db.confidentialVault || []).find((c) => c.id === id && c.organizationId === vaultTenantId)
      if (!item) return json(res, 404, { error: 'Confidential candidate not found.' })
      return json(res, 200, { candidate: item })
    }

    /** Update candidate status */
    if (req.method === 'PUT' && path.startsWith('/api/confidential/candidates/') && path.endsWith('/status')) {
      const id = path.split('/')[4]
      const body = await readBody(req)
      const db = loadDb()
      const idx = (db.confidentialVault || []).findIndex((c) => c.id === id && c.organizationId === vaultTenantId)
      if (idx < 0) return json(res, 404, { error: 'Confidential candidate not found.' })

      db.confidentialVault[idx].status = body.status || db.confidentialVault[idx].status
      await saveDb(db)
      return json(res, 200, { success: true, candidate: db.confidentialVault[idx] })
    }

    /** Delete candidate */
    if (req.method === 'DELETE' && path.startsWith('/api/confidential/candidates/')) {
      const id = path.replace('/api/confidential/candidates/', '')
      const db = loadDb()
      db.confidentialVault = (db.confidentialVault || []).filter((c) => c.id !== id || c.organizationId !== vaultTenantId)
      await saveDb(db)
      return json(res, 200, { success: true, deletedId: id })
    }

    /** Export all confidential vault data */
    if (req.method === 'GET' && path === '/api/confidential/export') {
      const db = loadDb()
      return json(res, 200, {
        exportedAt: new Date().toISOString(),
        total: (db.confidentialVault || []).filter(c => c.organizationId === vaultTenantId).length,
        candidates: (db.confidentialVault || []).filter(c => c.organizationId === vaultTenantId),
      })
    }

    /** Confidential KPI metrics */
    if (req.method === 'GET' && path === '/api/confidential/stats') {
      const db = loadDb()
      const list = (db.confidentialVault || []).filter(c => c.organizationId === vaultTenantId)
      const scored = list.filter((c) => typeof c.interviewScore === 'number')
      const avgScore = scored.length
        ? Math.round(scored.reduce((a, b) => a + (b.interviewScore || 0), 0) / scored.length)
        : 0

      return json(res, 200, {
        totalCandidates: list.length,
        resumesParsed: list.filter((c) => Boolean(c.resumeText)).length,
        interviewsCompleted: scored.length,
        averageTalentScore: avgScore,
      })
    }

    if (serveSpaStatic(req, res, path)) return

    return json(res, 404, { error: 'Not found' })
  } catch (err) {
    console.error('[api] request failed', err.code || err.name)
    return json(res, err.status || 500, {
      error: err.status ? err.message : 'Server error',
    })
  }
})

const assessmentHandler = createAssessmentHandler({ databaseUrl: config.databaseUrl, requireAuth, readBody, json, rateLimit })
const personalizedHandler = createPersonalizedHandler({
  databaseUrl: config.databaseUrl, requireAuth, readBody, json, rateLimit,
  onResult: async (email, result, link, organizationId) => {
    const db = loadDb()
    db.interviews[email] = result
    if (link.application_id) {
      const app = getOrgApplication(db, organizationId, link.application_id)
      if (!app || app.candidateEmail !== email) throw Object.assign(new Error('Application not found'), { status: 404 })
      updateApplicationInterview(db, app.id, organizationId, result, { assessmentSessionId: result.sessionId, vendorReport: null })
    }
    await saveDb(db)
  },
})

try {
  await bootstrapDb()
} catch (err) {
  console.error('[db] Failed to connect or load PostgreSQL:', err instanceof Error ? err.message : err)
  process.exit(1)
}

server.listen(PORT, () => {
  console.log(`HIRERIGHT API v2 [${config.environment}] on http://localhost:${PORT}`)
  console.log('Storage: PostgreSQL (Neon)')
  if (serveFrontend) {
    console.log(`Frontend SPA: serving ${frontendDistRoot} (unknown routes → index.html)`)
  }
  const geminiHint = geminiKeyFormatWarning()
  if (geminiHint) console.warn(`[llm] ${geminiHint}`)
  const key = resolveGeminiApiKey()
  const authLabel = key.startsWith('AQ.') ? 'Gemini auth key (AQ.)' : 'Gemini'
  console.log(
    `Interview agent: ${llmConfigured() && !geminiHint ? `LLM enabled (${authLabel})` : geminiHint ? 'LLM key unrecognized — check GEMINI_API_KEY' : 'local adaptive agent (set GEMINI_API_KEY)'}`,
  )
  console.log(`Demo accounts: ${config.allowDemoAccounts ? 'enabled' : 'disabled'}`)
})
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.warn(`Port ${PORT} already in use — API assumed running.`)
    return
  }
  console.error(err)
  process.exit(1)
})

