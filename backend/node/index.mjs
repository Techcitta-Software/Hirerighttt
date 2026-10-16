import { createServer } from 'node:http'
import { createAssessmentHandler } from './assessment/routes.mjs'
import { randomBytes } from 'node:crypto'
import { hashPassword, verifyPassword } from './authPasswords.mjs'
import { normalizePhone, isValidPhoneInput, findUserByPhone } from './authPhone.mjs'
import { evaluateResumeAgainstJd, generateVendorAssessmentSheet } from './vendor/aiEvaluation.mjs'
import { config, assertProductionConfig, isProdLike } from './config.mjs'
import {
  loadDb as loadDbFromStore,
  saveDb as persistDb,
  saveSessionToken,
  resolveSessionEmail,
  deleteSessionToken,
  pingDatabase,
  appendInterviewHistory,
  emptyDb,
  getReadyPool,
} from './db/store.mjs'
import * as interviewRepo from './interviewResults/repository.mjs'
import {
  validateAnswerPayload,
  buildQaPair,
  candidateRowFromUserAndProfile,
} from './interviewResults/logic.mjs'
import {
  evaluateInBackground,
  waitForEvaluations,
  evaluatePair,
} from './interviewResults/evaluator.mjs'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { provisionEmployerTenant, tagVaultForOrganization } from './db/saasHelpers.mjs'
import { geminiChat, resolveGeminiApiKey } from './geminiClient.mjs'
import { groqConfigured, groqWhisperModel, transcribeGroqWhisper } from './groqWhisper.mjs'
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
  getJobByShareableCode,
  listOrgJobs,
  getOrgJob,
  getOrgApplication,
  createJobApplication,
  listJobApplications,
  updateApplicationInterview,
  publicJobPayload,
} from './vendor/jobs.mjs'
import {
  generateAdaptiveQuestion,
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

const SEED_CONFIDENTIAL_CANDIDATES = [
  {
    id: 'conf-1',
    name: 'Sneha Iyer',
    email: 'sneha.iyer@example.com',
    phone: '+91 98765 43210',
    currentRole: 'Senior Frontend Developer',
    experienceYears: '5 years',
    location: 'Hyderabad, India',
    skills: ['React', 'TypeScript', 'Next.js', 'Redux', 'TailwindCSS', 'REST APIs'],
    resumeName: 'sneha_iyer_resume.pdf',
    resumeText: `SNEHA IYER
Senior Frontend Developer · Hyderabad, India
Email: sneha.iyer@example.com · Phone: +91 98765 43210

PROFESSIONAL SUMMARY
Senior Frontend Engineer with 5+ years of experience building high-performance web applications using React, TypeScript, Next.js, and modern state management. Led UI architecture for enterprise SaaS dashboards with 100K+ monthly active users.

WORK EXPERIENCE
Senior Frontend Developer — TechCita Solutions (2022 – Present)
• Architected scalable component library in TypeScript & React, improving development speed by 35%.
• Optimized bundle size by 42% using Vite and code-splitting techniques.
• Mentored 6 junior and mid-level developers in testing and design patterns.

Frontend Engineer — Infosys (2019 – 2022)
• Developed responsive client portals in React and Redux Toolkit.
• Integrated GraphQL and REST endpoints with optimistic UI updates.

EDUCATION
B.Tech in Computer Science — JNTU Hyderabad (2015 – 2019)`,
    summary: 'Senior Frontend Engineer with 5+ years building React & TypeScript enterprise web applications.',
    interviewScore: 92,
    status: 'Shortlisted',
    source: 'Employer Assessment Link',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
  {
    id: 'conf-2',
    name: 'Rahul Kapoor',
    email: 'rahul.k@example.com',
    phone: '+91 91234 56789',
    currentRole: 'Backend Systems Engineer',
    experienceYears: '4 years',
    location: 'Bangalore, India',
    skills: ['Node.js', 'Python', 'FastAPI', 'PostgreSQL', 'Docker', 'Redis', 'AWS'],
    resumeName: 'rahul_kapoor_backend.pdf',
    resumeText: `RAHUL KAPOOR
Backend Systems Engineer · Bangalore, India
Email: rahul.k@example.com · Phone: +91 91234 56789

PROFESSIONAL SUMMARY
Backend Developer with 4 years building microservices, high-throughput asynchronous APIs, and real-time WebSocket infrastructure in Node.js and Python.

WORK EXPERIENCE
Backend Developer — CloudScale Systems (2021 – Present)
• Designed and maintained distributed microservices handling 15M requests/day in FastAPI & PostgreSQL.
• Implemented caching layers in Redis reducing database query latency by 60%.

EDUCATION
B.E. in Information Technology — RVCE Bangalore`,
    summary: 'Backend Engineer experienced in distributed microservices, FastAPI, Redis, and high-throughput pipelines.',
    interviewScore: 88,
    status: 'Screening',
    source: 'Direct Ingestion',
    createdAt: new Date(Date.now() - 86400000 * 4).toISOString(),
  },
  {
    id: 'conf-3',
    name: 'Ananya Rao',
    email: 'ananya.rao@example.com',
    phone: '+91 99887 76655',
    currentRole: 'Full Stack Engineer',
    experienceYears: '3 years',
    location: 'Remote',
    skills: ['React', 'Node.js', 'TypeScript', 'MongoDB', 'Express', 'GraphQL'],
    resumeName: 'ananya_rao_fullstack.docx',
    resumeText: `ANANYA RAO
Full Stack Developer · Remote
Email: ananya.rao@example.com

SUMMARY
Full Stack Engineer with 3 years building end-to-end web applications with React, Node.js, and TypeScript. Passionate about responsive UI and clean RESTful API design.`,
    summary: 'Full Stack Developer proficient across modern JavaScript ecosystem and cloud deployments.',
    interviewScore: 85,
    status: 'Technical',
    source: 'Profile Upload',
    createdAt: new Date(Date.now() - 86400000 * 6).toISOString(),
  },
]

async function seedDemoUsers(db) {
  if (!config.allowDemoAccounts) return db
  const demos = [
    {
      name: 'Arjun Sharma',
      email: 'demo@hireright.com',
      password: 'password123',
      role: 'jobseeker',
    },
    {
      name: 'Sarah Jenkins (Recruiter)',
      email: 'employer@hireright.com',
      password: 'password123',
      role: 'employer',
      companyName: 'TechCitta Solutions',
    },
    {
      name: 'Alex Morgan (Admin)',
      email: 'admin@hireright.com',
      password: 'password123',
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
  if (!isProdLike && (!db.confidentialVault || db.confidentialVault.length === 0)) {
    db.confidentialVault = tagVaultForOrganization([...SEED_CONFIDENTIAL_CANDIDATES], 'org-platform')
    changed = true
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

/** Load interview session from memory or PostgreSQL (survives API restarts). */
async function resolveInterviewSession(db, sessionId, email) {
  if (!sessionId) return null
  const cached = /** @type {any} */ (db.interviewSessions[sessionId])
  if (cached && cached.email === email) return cached
  if (!config.databaseUrl) return null
  try {
    const pool = await getReadyPool(config.databaseUrl)
    const res = await pool.query(
      'SELECT email, data FROM interview_sessions WHERE session_id = $1',
      [sessionId],
    )
    const row = res.rows[0]
    if (!row || row.email !== email) return null
    const session = { ...(row.data || {}), email: row.email, id: sessionId }
    db.interviewSessions[sessionId] = session
    dbCache = db
    return session
  } catch (err) {
    console.warn('[interview] session lookup failed', err instanceof Error ? err.message : err)
    return null
  }
}

async function syncCandidateRow(db, email) {
  const user = db.users.find((u) => u.email === email)
  if (!user || user.role === 'employer' || !user.passwordHash) return
  if (!config.databaseUrl) return
  try {
    const pool = await getReadyPool(config.databaseUrl)
    await interviewRepo.upsertCandidate(
      pool,
      candidateRowFromUserAndProfile(user, db.profiles[email] || null),
    )
  } catch (err) {
    console.warn('[candidates] sync failed', email, err instanceof Error ? err.message : err)
  }
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
    let synced = 0
    for (const u of dbCache.users) {
      if (u.role === 'employer' || !u.passwordHash) continue
      await syncCandidateRow(dbCache, u.email)
      synced++
    }
    if (synced > 0) console.log(`[candidates] Synced ${synced} job-seeker row(s) to Neon.`)
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
  if (!email || !dbCache.users.some(user => user.email === email && user.status === 'active')) {
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
    if (req.method === 'GET' && (path === '/' || path === '/api')) {
      return json(res, 200, {
        ok: true,
        service: 'hireright-api',
        hint: 'Use /api/health for status. Interview routes live under /api/interview/* and require Authorization.',
        health: '/api/health',
        docs: 'See README.md and docs/DATABASE.md in the repo.',
      })
    }

    if (req.method === 'GET' && path === '/api/health') {
      const dbPing = await pingDatabase(config.databaseUrl)
      return json(res, 200, {
        ok: true,
        service: 'hireright-api',
        version: '2.0.0',
        llm: llmConfigured(),
        models: publicModelConfig(),
        database: {
          configured: true,
          storage: 'postgresql',
          connected: Boolean(dbPing?.ok),
          detail: dbPing?.reason || null,
        },
        groqStt: groqConfigured(),
        groqWhisperModel: groqConfigured() ? groqWhisperModel() : null,
        features: {
          interviewAgent: true,
          resumeAwareQuestions: true,
          adaptiveScoring: true,
          faceIntegrityClient: true,
          openrouterActive: Boolean(process.env.OPENROUTER_API_KEY),
          groqStt: groqConfigured(),
        },
      })
    }

    if (req.method === 'GET' && path === '/api/plans') {
      const db = loadDb()
      const plans = (db.subscriptionPlans || []).filter((p) => p.isPublic !== false)
      return json(res, 200, { plans })
    }

    /** Public: resolve shareable job link (no auth) */
    if (req.method === 'GET' && path.startsWith('/api/jobs/public/')) {
      const code = path.replace('/api/jobs/public/', '').split('/')[0]
      const db = loadDb()
      const job = getJobByShareableCode(db, code)
      if (!job) return json(res, 404, { error: 'Job link not found or expired.' })
      return json(res, 200, { job: publicJobPayload(job) })
    }

    /** Public apply: ATS score + application row (optional Bearer for logged-in candidate) */
    if (req.method === 'POST' && path.startsWith('/api/jobs/public/') && path.endsWith('/apply')) {
      const parts = path.split('/')
      const code = parts[4]
      const body = await readBody(req)
      const db = loadDb()
      const job = getJobByShareableCode(db, code)
      if (!job) return json(res, 404, { error: 'Job link not found or expired.' })
      let candidateUserId = null
      const optionalAuth = await authEmail(req)
      if (optionalAuth) {
        const u = db.users.find((x) => x.email === optionalAuth)
        candidateUserId = u?.id || null
      }
      const resumeText = String(body.resumeText || '')
      const atsEvaluation = await evaluateResumeAgainstJd({
        resumeText,
        jobDescription: job.jobDescription || '',
        requiredSkills: job.requiredSkills || [],
        roleTitle: job.roleTrack,
      })
      const { application, created, ats } = createJobApplication(db, job, {
        ...body,
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
      return { user, tenant }
    }

    if (req.method === 'POST' && path === '/api/vendor/jobs') {
      const db = loadDb()
      const ctx = await requireEmployerTenant(req, res, db)
      if (!ctx) return
      const body = await readBody(req)
      const job = createVendorJob(db, ctx.tenant.organization.id, ctx.user.id, body)
      await saveDb(db)
      return json(res, 201, { job })
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

    if (req.method === 'GET' && path.startsWith('/api/vendor/applicants/') && path.endsWith('/report')) {
      const db = loadDb()
      const ctx = await requireEmployerTenant(req, res, db)
      if (!ctx) return
      const appId = path.split('/')[4]
      const app = getOrgApplication(db, ctx.tenant.organization.id, appId)
      if (!app) return json(res, 404, { error: 'Applicant not found.' })
      const job = getOrgJob(db, ctx.tenant.organization.id, app.jobId)
      if (app.data?.vendorReport?.aiGenerated) {
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

    if (req.method === 'PATCH' && path.startsWith('/api/vendor/applicants/')) {
      const db = loadDb()
      const ctx = await requireEmployerTenant(req, res, db)
      if (!ctx) return
      const appId = path.replace('/api/vendor/applicants/', '')
      const body = await readBody(req)
      const app = (db.employerApplications || []).find(
        (a) => a.id === appId && a.organizationId === ctx.tenant.organization.id,
      )
      if (!app) return json(res, 404, { error: 'Applicant not found.' })
      if (body.status) app.status = String(body.status)
      await saveDb(db)
      return json(res, 200, { application: app })
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
      const providerName = isGemini ? 'Google Gemini AI' : 'OpenAI / OpenRouter AI'

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
              model,
              statusCode: ping.status,
              authMode: apiKey.startsWith('AQ.') ? 'gemini-auth-key-native' : 'gemini-openai-compatible',
              message: `✓ ${providerName} (${model}) is LIVE & Synchronized!`,
              models,
            })
          }
          const formatHint = geminiKeyFormatWarning()
          return json(res, 200, {
            active: false,
            configured: true,
            provider: providerName,
            model,
            statusCode: ping.status,
            message: formatHint || ping.error || `${providerName} error (${ping.status})`,
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
            model,
            statusCode: pingRes.status,
            message: `✓ ${providerName} (${model}) is LIVE & Synchronized!`,
            models,
          })
        }
        const errData = await pingRes.json().catch(() => ({}))
        return json(res, 200, {
          active: false,
          configured: true,
          provider: providerName,
          model,
          statusCode: pingRes.status,
          message: errData.error?.message || `${providerName} error (${pingRes.status})`,
        })
      } catch (err) {
        return json(res, 200, {
          active: false,
          configured: true,
          provider: providerName,
          model,
          message: err instanceof Error ? err.message : `Network error connecting to ${providerName}`,
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
      const db = loadDb()
      if (db.users.some((u) => u.email === email)) {
        return json(res, 409, { error: 'An account with this email already exists.' })
      }
      const phoneRaw = String(body.phone || '').trim()
      if (!isValidPhoneInput(phoneRaw)) {
        return json(res, 400, {
          error: 'A valid mobile number is required at signup (10–15 digits, include country code if needed).',
        })
      }
      const phone = normalizePhone(phoneRaw)
      if (findUserByPhone(db.users, phoneRaw)) {
        return json(res, 409, { error: 'An account with this mobile number already exists.' })
      }
      const role = body.role === 'employer' ? 'employer' : 'jobseeker'
      const companyName = String(body.companyName || '').trim()
      const usernameRaw = String(body.username || '').trim()
      if (usernameRaw && (usernameRaw.length < 2 || usernameRaw.length > 40 || !/^[A-Za-z0-9._-]+$/.test(usernameRaw))) {
        return json(res, 400, {
          error: 'Username must be 2–40 characters (letters, numbers, . _ -).',
        })
      }
      const user = {
        id: randomBytes(8).toString('hex'),
        name,
        email,
        phone,
        passwordHash: await hashPassword(password),
        role,
        companyName: role === 'employer' ? companyName : undefined,
        username: usernameRaw || undefined,
        status: 'active',
        createdAt: new Date().toISOString(),
      }
      db.users.push(user)
      if (role === 'employer') {
        provisionEmployerTenant(db, user)
      }
      dbCache = db
      await persistDb(db, config.databaseUrl)
      if (role !== 'employer' && config.databaseUrl) {
        await upsertCandidateTalent(config.databaseUrl, user, {}, null)
      }
      if (role === 'jobseeker') {
        await syncCandidateRow(db, email)
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
      if (!user.passwordHash.startsWith('scrypt$')) {
        user.passwordHash = await hashPassword(password)
        await saveDb(db)
      }
      if (user.role !== 'employer') {
        void syncCandidateRow(db, email)
      }
      const token = randomBytes(16).toString('hex')
      await registerSession(token, email)
      return json(res, 200, {
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role || (email.includes('employer') ? 'employer' : 'jobseeker'),
          companyName: user.companyName,
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
          role: user.role,
          companyName: user.companyName,
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
      void syncCandidateRow(db, email)
      return json(res, 200, { profile: db.profiles[email] })
    }

    if (req.method === 'GET' && path === '/api/candidates/me') {
      const email = await requireAuth(req, res)
      if (!email) return
      const db = loadDb()
      const user = db.users.find((u) => u.email === email)
      if (!user || user.role === 'employer') {
        return json(res, 403, { error: 'Candidate account required.' })
      }
      if (!config.databaseUrl) {
        return json(res, 503, { error: 'Database not configured.' })
      }
      try {
        const pool = await getReadyPool(config.databaseUrl)
        let candidate = await interviewRepo.getCandidate(pool, user.id)
        if (!candidate) {
          await syncCandidateRow(db, email)
          candidate = await interviewRepo.getCandidate(pool, user.id)
        }
        if (!candidate) {
          return json(res, 404, { error: 'Candidate profile not found.' })
        }
        return json(res, 200, { candidate })
      } catch (err) {
        return json(res, 500, {
          error: err instanceof Error ? err.message : 'Could not load candidate.',
        })
      }
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

    /** Silero VAD utterance → Groq Whisper (Bearer token required) */
    if (req.method === 'POST' && path === '/api/interview/transcribe') {
      const email = await requireAuth(req, res)
      if (!email) return
      if (!groqConfigured()) {
        return json(res, 503, { error: 'Groq speech-to-text is not configured on the server.' })
      }
      if (!rateLimit(`ivtx:${email}`, 300)) {
        return json(res, 429, { error: 'Transcription rate limited. Slow down slightly.' })
      }
      const body = await readBody(req)
      const b64 = String(body.audioBase64 || '')
      if (!b64) return json(res, 400, { error: 'audioBase64 is required.' })
      let audioBuffer
      try {
        audioBuffer = Buffer.from(b64, 'base64')
      } catch {
        return json(res, 400, { error: 'Invalid audioBase64 payload.' })
      }
      if (audioBuffer.length < 800) {
        return json(res, 400, { error: 'Audio chunk too short.' })
      }
      if (audioBuffer.length > 2_500_000) {
        return json(res, 413, { error: 'Audio chunk too large.' })
      }
      const mimeType = String(body.mimeType || 'audio/wav')
      try {
        const text = await transcribeGroqWhisper(audioBuffer, {
          language: body.language ? String(body.language) : undefined,
          mimeType,
        })
        return json(res, 200, {
          text,
          provider: 'groq',
          model: groqWhisperModel(),
        })
      } catch (err) {
        console.warn('[groq-whisper]', err instanceof Error ? err.message : err)
        return json(res, 502, {
          error: err instanceof Error ? err.message : 'Groq transcription failed.',
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
      const explicitRoleTrack =
        body.explicitRoleTrack === true || jobDescription.length >= 40

      let first
      try {
        first = await generateAdaptiveQuestion({
          ctx,
          profile,
          role,
          level,
          jobDescription,
          explicitRoleTrack,
          history: [],
          lastAnswer: '',
          accountName: account?.name,
        })
      } catch (err) {
        return json(res, 503, {
          error: err.message || 'AI question generation unavailable.',
        })
      }
      const questions = [first]
      const agentLabel = llmConfigured() ? 'llm-adaptive' : 'adaptive-agent'
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
        jobDescription,
        explicitRoleTrack,
        jobId: body.jobId ? String(body.jobId) : null,
        applicationId: body.applicationId ? String(body.applicationId) : null,
        organizationId: body.organizationId ? String(body.organizationId) : null,
        primarySkills: Array.isArray(body.primarySkills) ? body.primarySkills : [],
        atsScore: typeof body.atsScore === 'number' ? body.atsScore : null,
        jdMatchScore: typeof body.jdMatchScore === 'number' ? body.jdMatchScore : null,
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

      if (account && config.databaseUrl) {
        try {
          const pool = await getReadyPool(config.databaseUrl)
          await interviewRepo.createInterviewResult(pool, {
            id: sessionId,
            candidateId: account.id,
            candidateName: ctx?.name || account.name || '',
            candidateEmail: email,
            role,
            level,
          })
        } catch (err) {
          console.warn('[interview-results] create failed', err instanceof Error ? err.message : err)
        }
      }

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
        body.explicitRoleTrack === true ||
        session.explicitRoleTrack === true ||
        nextJobDescription.length >= 40
      let next
      try {
        next = await generateAdaptiveQuestion({
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
      } catch (err) {
        return json(res, 503, {
          error: err.message || 'AI question generation unavailable.',
        })
      }
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

    if (req.method === 'POST' && path === '/api/interview/answer') {
      const email = await requireAuth(req, res)
      if (!email) return
      if (!rateLimit(`ivanswer:${email}`, 120)) {
        return json(res, 429, { error: 'Too many answers.' })
      }
      const body = await readBody(req)
      const parsed = validateAnswerPayload(body)
      if (!parsed.ok) return json(res, 400, { error: parsed.error })
      const db = loadDb()
      const account = db.users.find((u) => u.email === email)
      const sessionId = parsed.value.sessionId
      if (String(sessionId).startsWith('local-')) {
        return json(res, 400, {
          error: 'Offline interview session cannot be stored. Start the interview again with the API running.',
        })
      }
      const session = await resolveInterviewSession(db, sessionId, email)
      if (!account || !session) {
        return json(res, 404, { error: 'Interview session not found.' })
      }
      if (!config.databaseUrl) {
        return json(res, 503, { error: 'Database not configured.' })
      }
      const pool = await getReadyPool(config.databaseUrl)
      await interviewRepo.createInterviewResult(pool, {
        id: session.id,
        candidateId: account.id,
        candidateName: session.context?.name || account.name || '',
        candidateEmail: email,
        role: session.role,
        level: session.level,
      })
      const pair = buildQaPair(parsed.value)
      try {
        await interviewRepo.recordQaPair(pool, session.id, account.id, pair)
      } catch (err) {
        return json(res, err.status || 500, { error: err.message })
      }
      evaluateInBackground({
        pool,
        sessionId: session.id,
        pair,
        ctx: { ...(session.context || {}), role: session.role, level: session.level },
      })
      return json(res, 202, {
        stored: true,
        sessionId: session.id,
        questionIndex: pair.questionIndex,
        evaluation: 'pending',
      })
    }

    if (req.method === 'GET' && path === '/api/interview/results') {
      const email = await requireAuth(req, res)
      if (!email) return
      const db = loadDb()
      const account = db.users.find((u) => u.email === email)
      if (!account) return json(res, 401, { error: 'Unauthorized' })
      if (!config.databaseUrl) return json(res, 503, { error: 'Database not configured.' })
      const pool = await getReadyPool(config.databaseUrl)
      const results = await interviewRepo.listInterviewResults(pool, account.id, {
        limit: Number(url.searchParams.get('limit') || 20),
      })
      return json(res, 200, { results })
    }

    if (req.method === 'GET' && path.startsWith('/api/interview/results/')) {
      const email = await requireAuth(req, res)
      if (!email) return
      const sessionId = decodeURIComponent(path.slice('/api/interview/results/'.length))
      const db = loadDb()
      const account = db.users.find((u) => u.email === email)
      if (!account) return json(res, 401, { error: 'Unauthorized' })
      if (!config.databaseUrl) return json(res, 503, { error: 'Database not configured.' })
      const pool = await getReadyPool(config.databaseUrl)
      const result = await interviewRepo.getInterviewResult(pool, sessionId, account.id)
      if (!result) return json(res, 404, { error: 'Interview result not found.' })
      return json(res, 200, { result })
    }

    if (req.method === 'POST' && path === '/api/interview/complete') {
      const email = await requireAuth(req, res)
      if (!email) return
      if (!rateLimit(`ivcomplete:${email}`, 20)) {
        return json(res, 429, { error: 'Too many complete requests.' })
      }
      const body = await readBody(req)
      const sessionId = String(body.sessionId || '').trim()
      const status = body.status === 'abandoned' ? 'abandoned' : 'completed'
      const db = loadDb()
      const account = db.users.find((u) => u.email === email)
      const session = sessionId ? await resolveInterviewSession(db, sessionId, email) : null
      if (!account || !sessionId || !session) {
        return json(res, 404, { error: 'Interview session not found.' })
      }
      if (!config.databaseUrl) return json(res, 503, { error: 'Database not configured.' })
      const pool = await getReadyPool(config.databaseUrl)
      await waitForEvaluations(sessionId, 15000)
      let row = await interviewRepo.getInterviewResult(pool, sessionId, account.id)
      if (row?.qaPairs?.length) {
        const ctx = {
          ...(session?.context || {}),
          role: session?.role || row.role,
          level: session?.level || row.level,
        }
        const pending = row.qaPairs.filter((p) => p.evaluation?.status === 'pending').slice(0, 10)
        await Promise.allSettled(
          pending.map(async (p) => {
            const ev = await evaluatePair({ pair: p, ctx })
            await interviewRepo.saveEvaluation(pool, sessionId, p.questionIndex, {
              ...ev,
              answer: p.answer,
            })
          }),
        )
      }
      await interviewRepo.finalizeInterviewResult(pool, sessionId, { status })
      row = await interviewRepo.getInterviewResult(pool, sessionId, account.id)
      return json(res, 200, { result: row })
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
      if (session && session.email !== email) {
        return json(res, 404, { error: 'Interview session not found.' })
      }

      const profile = mergeInterviewProfile(db, email, body.profile)

      const questions = body.questions || session?.questions
      const answers = body.answers || []
      const role = String(body.role || session?.role || 'Full Stack Engineer')
      const level = String(body.level || session?.level || '1–3 years')

      if (!Array.isArray(questions) || questions.length === 0) {
        return json(res, 400, { error: 'Questions required to score interview.' })
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
        questions,
        answers,
        profile,
        integrity,
        accountName: db.users.find((u) => u.email === email)?.name,
        durationMinutes,
      })

      db.interviews[email] = result
      if (session) {
        session.status = 'completed'
        session.answers = answers
        session.result = result
        session.completedAt = new Date().toISOString()
        db.interviewSessions[sessionId] = session
      }
      await saveDb(db)
      const scoredUser = db.users.find((u) => u.email === email)
      if (session?.applicationId && session?.organizationId) {
        const app = getOrgApplication(db, session.organizationId, session.applicationId)
        const job = app ? getOrgJob(db, session.organizationId, app.jobId) : null
        let vendorReport = null
        if (app) {
          vendorReport = await generateVendorAssessmentSheet({
            candidateName: app.data.candidateName || email,
            jobTitle: job?.title || app.data.jobTitle,
            company: job?.company || app.data.company,
            jobDescription: job?.jobDescription || session.jobDescription || '',
            resumeText: app.data.resumeText || String(db.profiles[email]?.resumeText || ''),
            atsEvaluation: {
              atsScore: app.data.atsScore ?? session.atsScore,
              jdMatchScore: app.data.jdMatchScore ?? session.jdMatchScore,
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
        updateApplicationInterview(db, session.applicationId, session.organizationId, result, {
          atsScore: session.atsScore ?? null,
          jdMatchScore: session.jdMatchScore ?? null,
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
      if (sessionId && config.databaseUrl) {
        void (async () => {
          try {
            const pool = await getReadyPool(config.databaseUrl)
            await waitForEvaluations(sessionId, 15000)
            await interviewRepo.finalizeInterviewResult(pool, sessionId, { status: 'completed' })
          } catch (err) {
            console.warn('[interview-results] finalize failed', err instanceof Error ? err.message : err)
          }
        })()
      }
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

    return json(res, 404, { error: 'Not found' })
  } catch (err) {
    console.error('[api] request failed', err.code || err.name)
    return json(res, err.status || 500, {
      error: err.status ? err.message : 'Server error',
    })
  }
})

const assessmentHandler = createAssessmentHandler({ databaseUrl: config.databaseUrl, requireAuth, readBody, json, rateLimit })

try {
  await bootstrapDb()
} catch (err) {
  console.error('[db] Failed to connect or load PostgreSQL:', err instanceof Error ? err.message : err)
  process.exit(1)
}

server.listen(PORT, () => {
  console.log(`HIRERIGHT API v2 [${config.environment}] on http://localhost:${PORT}`)
  console.log('Storage: PostgreSQL (Neon)')
  const geminiHint = geminiKeyFormatWarning()
  if (geminiHint) console.warn(`[llm] ${geminiHint}`)
  const key = resolveGeminiApiKey()
  const authLabel = key.startsWith('AQ.') ? 'Gemini auth key (AQ.)' : 'Gemini'
  console.log(
    `Interview agent: ${llmConfigured() && !geminiHint ? `LLM enabled (${authLabel})` : geminiHint ? 'LLM key unrecognized — check GEMINI_API_KEY' : 'local adaptive agent (set GEMINI_API_KEY)'}`,
  )
  console.log(`Demo accounts: ${config.allowDemoAccounts ? 'enabled' : 'disabled'}`)
})
server.on('error', async (err) => {
  if (err && err.code === 'EADDRINUSE') {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`)
      if (res.ok) {
        console.log(`Port ${PORT} already in use — existing HIRERIGHT API responded OK at /api/health`)
        process.exit(0)
      }
    } catch {
      // fall through
    }
    console.error(
      `Port ${PORT} is in use but /api/health did not respond. Stop the other process (or reboot terminal) then run: npm start (from repo root) or npm --prefix node start (from backend/).`,
    )
    process.exit(1)
  }
  console.error(err)
  process.exit(1)
})
