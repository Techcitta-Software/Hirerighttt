import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { config, assertProductionConfig, isProdLike } from './config.mjs'
import { emailFromSupabaseToken } from './supabaseAuth.mjs'
import {
  loadDb as loadDbFromStore,
  saveDb as persistDb,
  saveSessionToken,
  resolveSessionEmail,
  deleteSessionToken,
  emptyDb,
} from './db/store.mjs'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildInterviewQuestions,
  generateAdaptiveQuestion,
  generateInterviewTurn,
  llmConfigured,
  parseResumeWithAI,
  resolveCandidateName,
  scoreInterviewSession,
  summarizeProfile,
  questionGenerationPayload,
  resolveLlmTransport,
  interviewModelCascade,
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

/** @typedef {{ id: string, name: string, email: string, passwordHash: string, role?: string, companyName?: string, createdAt: string }} User */

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

function seedDemoUsers(db) {
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
        passwordHash: hashPassword(demo.password),
        role: demo.role,
        companyName: demo.companyName,
        createdAt: new Date().toISOString(),
      })
      changed = true
    }
  }
  if (!isProdLike && (!db.confidentialVault || db.confidentialVault.length === 0)) {
    db.confidentialVault = [...SEED_CONFIDENTIAL_CANDIDATES]
    changed = true
  }
  if (changed) saveDb(db)
  return db
}

function loadDb() {
  return dbCache
}

function saveDb(db) {
  dbCache = db
  void persistDb(db, config.databaseUrl).catch((err) => {
    console.error('[db] persist failed:', err)
  })
}

async function bootstrapDb() {
  let raw = await loadDbFromStore(config.databaseUrl)
  if (!raw.users) raw.users = []
  if (!raw.profiles) raw.profiles = {}
  if (!raw.interviews) raw.interviews = {}
  if (!raw.applications) raw.applications = {}
  if (!raw.interviewSessions) raw.interviewSessions = {}
  if (!raw.confidentialVault) raw.confidentialVault = []
  dbCache = seedDemoUsers(raw)
}

function hashPassword(password, salt = randomBytes(8).toString('hex')) {
  const hash = createHash('sha256').update(`${salt}:${password}`).digest('hex')
  return `${salt}$${hash}`
}

function verifyPassword(password, stored) {
  const [salt] = stored.split('$')
  return hashPassword(password, salt) === stored
}

/** @type {import('node:http').IncomingMessage | null} */
let activeReq = null

function json(res, status, body) {
  const payload = JSON.stringify(body)
  const origin = activeReq?.headers?.origin
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
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 4_000_000) reject(new Error('Body too large'))
    })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch {
        reject(new Error('Invalid JSON'))
      }
    })
  })
}

const sessions = new Map()
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
  const supabaseEmail = emailFromSupabaseToken(token)
  if (supabaseEmail) return supabaseEmail
  if (config.databaseUrl) {
    const fromDb = await resolveSessionEmail(config.databaseUrl, token)
    if (fromDb) return fromDb
  }
  return sessions.get(token) || null
}

async function requireAuth(req, res) {
  const email = await authEmail(req)
  if (!email) {
    json(res, 401, { error: 'Unauthorized' })
    return null
  }
  return email
}

async function registerSession(token, email) {
  sessions.set(token, email)
  if (config.databaseUrl) {
    await saveSessionToken(config.databaseUrl, token, email)
  }
}

/** Merge stored profile with client payload; resume-aware candidate name wins over demo account. */
function mergeInterviewProfile(db, email, bodyProfile) {
  const account = email ? db.users.find((u) => u.email === email) : null
  const stored = email ? /** @type {Record<string, unknown>} */ (db.profiles[email] || {}) : {}
  const merged = { ...stored, ...(bodyProfile || {}) }
  const resolved = resolveCandidateName(merged, account?.name)
  return { ...merged, fullName: resolved, name: resolved }
}

const server = createServer(async (req, res) => {
  activeReq = req
  if (req.method === 'OPTIONS') {
    return json(res, 204, {})
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`)
  const path = url.pathname
  const ip = clientIp(req)

  try {
    if (req.method === 'GET' && path === '/api/health') {
      return json(res, 200, {
        ok: true,
        service: 'hireright-api',
        version: '2.0.0',
        llm: llmConfigured(),
        features: {
          interviewAgent: true,
          resumeAwareQuestions: true,
          adaptiveScoring: true,
          faceIntegrityClient: true,
          openrouterActive: Boolean(process.env.OPENROUTER_API_KEY),
        },
      })
    }

    if (req.method === 'GET' && path === '/api/llm-status') {
      const apiKey =
        process.env.EXPERIENTIALLABS_API_KEY ||
        process.env.OPENAI_API_KEY ||
        process.env.GEMINI_API_KEY ||
        process.env.OPENROUTER_API_KEY ||
        process.env.LLM_API_KEY
      if (!apiKey) {
        return json(res, 200, {
          active: false,
          configured: false,
          provider: 'Built-in Local Agent',
          message: 'No LLM API key set. Running in local agent mode.',
        })
      }

      const transport = resolveLlmTransport(apiKey)
      const base = transport.base.replace(/\/$/, '')
      const cascade = interviewModelCascade()
      const pingModels = [cascade.primary, cascade.fallback, cascade.tertiary].filter(Boolean)

      const providerName =
        transport.provider === 'experiential'
          ? 'ExperientialLabs AI Gateway'
          : transport.provider === 'google-gemini'
            ? 'Google Gemini AI'
            : 'OpenAI / OpenRouter AI'

      try {
        const pingHeaders = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        }
        if (transport.isGemini) {
          pingHeaders['x-goog-api-key'] = apiKey
        } else {
          pingHeaders['HTTP-Referer'] = 'http://localhost:5173'
          pingHeaders['X-Title'] = 'HIRERIGHTTT'
        }

        let lastStatus = 0
        let lastMessage = ''
        for (const pingModel of pingModels) {
          const pingRes = await fetch(`${base}/chat/completions`, {
            method: 'POST',
            headers: pingHeaders,
            body: JSON.stringify({
              model: pingModel,
              messages: [{ role: 'user', content: 'Ping' }],
              max_tokens: 5,
            }),
          })
          if (pingRes.ok) {
            const slot =
              pingModel === cascade.primary
                ? 'primary'
                : pingModel === cascade.fallback
                  ? 'fallback'
                  : 'tertiary'
            return json(res, 200, {
              active: true,
              configured: true,
              provider: providerName,
              model: pingModel,
              interviewPrimary: cascade.primary,
              interviewFallback: cascade.fallback,
              modelSlot: slot,
              statusCode: pingRes.status,
              message: `✓ Interview LLM live (${slot}: ${pingModel}). Order: ${cascade.primary} → ${cascade.fallback}${cascade.tertiary ? ` → ${cascade.tertiary}` : ''}`,
            })
          }
          lastStatus = pingRes.status
          const errData = await pingRes.json().catch(() => ({}))
          lastMessage = errData.error?.message || `${providerName} error (${pingRes.status})`
        }

        return json(res, 200, {
          active: false,
          configured: true,
          provider: providerName,
          model: cascade.primary,
          interviewPrimary: cascade.primary,
          interviewFallback: cascade.fallback,
          statusCode: lastStatus,
          message: lastMessage || 'All interview models failed ping.',
        })
      } catch (err) {
        return json(res, 200, {
          active: false,
          configured: true,
          provider: providerName,
          model: cascade.primary,
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
      if (!name || !email || password.length < 6) {
        return json(res, 400, { error: 'Name, email, and 6+ char password required.' })
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json(res, 400, { error: 'Enter a valid email address.' })
      }
      const db = loadDb()
      if (db.users.some((u) => u.email === email)) {
        return json(res, 409, { error: 'An account with this email already exists.' })
      }
      const role = body.role === 'employer' ? 'employer' : 'jobseeker'
      const companyName = String(body.companyName || '').trim()
      const user = {
        id: randomBytes(8).toString('hex'),
        name,
        email,
        passwordHash: hashPassword(password),
        role,
        companyName: role === 'employer' ? companyName : undefined,
        createdAt: new Date().toISOString(),
      }
      db.users.push(user)
      saveDb(db)
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
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return json(res, 401, { error: 'Email or password is incorrect.' })
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
      sessions.delete(token)
      await deleteSessionToken(config.databaseUrl, token)
      return json(res, 200, { ok: true })
    }

    if (req.method === 'GET' && path === '/api/me') {
      const email = await requireAuth(req, res)
      if (!email) return
      const db = loadDb()
      const user = db.users.find((u) => u.email === email)
      if (!user) return json(res, 401, { error: 'Unauthorized' })
      return json(res, 200, {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          companyName: user.companyName,
        },
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
      saveDb(db)
      return json(res, 200, { profile: db.profiles[email] })
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

      const adaptive = body.adaptive !== false
      const ctx = summarizeProfile(profile, account?.name)
      let questions
      let agentLabel

      const explicitRoleTrack =
        body.explicitRoleTrack === true || jobDescription.length >= 40

      if (adaptive) {
        const first = await generateAdaptiveQuestion({
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
        questions = [first]
        agentLabel =
          first?.generationSource === 'llm' || first?.focus === 'adaptive-llm'
            ? 'llm-adaptive'
            : 'template-adaptive'
      } else {
        const built = await buildInterviewQuestions(
          profile,
          role,
          level,
          jobDescription,
          account?.name,
        )
        questions = built.questions
        agentLabel = built.agent
      }

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
      saveDb(db)

      const q0 = questions[0]
      const allLlm =
        !adaptive &&
        questions.length > 0 &&
        questions.every(
          (q) => q?.generationSource === 'llm' || q?.focus === 'llm' || q?.focus === 'adaptive-llm',
        )
      const questionPlan = adaptive ? 'adaptive' : allLlm ? 'llm-fixed' : 'template-fixed'
      return json(res, 200, {
        sessionId,
        agent: agentLabel,
        adaptive,
        mode: adaptive ? 'adaptive' : 'fixed',
        questionPlan,
        llm: q0?.generationSource === 'llm' || q0?.focus === 'adaptive-llm' || q0?.focus === 'llm',
        ...questionGenerationPayload(q0),
        total: questions.length,
        questionIndex: 0,
        question: q0,
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
      if (session.mode === 'fixed') {
        return json(res, 400, {
          error: 'Fixed interview — no additional questions after the prepared set.',
        })
      }
      const profile = mergeInterviewProfile(db, email, body.profile)
      const account = db.users.find((u) => u.email === email)
      const ctx = summarizeProfile(profile, account?.name)
      const history = Array.isArray(body.history) ? body.history : session.history || []
      const lastAnswer = String(body.lastAnswer || '')
      if (body.lastQuestion && lastAnswer !== undefined) {
        history.push({ question: body.lastQuestion, answer: lastAnswer })
      }
      session.history = history
      const nextJobDescription = String(body.jobDescription || session.jobDescription || '')
      const explicitRoleTrack =
        body.explicitRoleTrack === true ||
        session.explicitRoleTrack === true ||
        nextJobDescription.length >= 40
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
      saveDb(db)
      return json(res, 200, {
        question: next,
        turn: history.length + 1,
        ...questionGenerationPayload(next),
      })
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
      saveDb(db)
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
      saveDb(db)
      return json(res, 200, { interview: result })
    }

    if (req.method === 'POST' && path === '/api/interview') {
      const email = await requireAuth(req, res)
      if (!email) return
      const body = await readBody(req)
      const db = loadDb()
      db.interviews[email] = body
      saveDb(db)
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
      saveDb(db)
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

      let list = db.confidentialVault || []
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
        name: String(body.name || 'Anonymous Candidate'),
        email: String(body.email || `candidate_${Date.now()}@confidential.io`),
        phone: String(body.phone || '+91 98000 00000'),
        currentRole: String(body.currentRole || 'Software Engineer'),
        experienceYears: String(body.experienceYears || '3 years'),
        location: String(body.location || 'Remote'),
        skills: Array.isArray(body.skills) ? body.skills : ['JavaScript', 'React'],
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
      saveDb(db)
      return json(res, 201, { success: true, candidate })
    }

    /** Get single candidate by ID */
    if (req.method === 'GET' && path.startsWith('/api/confidential/candidates/')) {
      const id = path.replace('/api/confidential/candidates/', '')
      const db = loadDb()
      const item = (db.confidentialVault || []).find((c) => c.id === id)
      if (!item) return json(res, 404, { error: 'Confidential candidate not found.' })
      return json(res, 200, { candidate: item })
    }

    /** Update candidate status */
    if (req.method === 'PUT' && path.startsWith('/api/confidential/candidates/') && path.endsWith('/status')) {
      const id = path.split('/')[4]
      const body = await readBody(req)
      const db = loadDb()
      const idx = (db.confidentialVault || []).findIndex((c) => c.id === id)
      if (idx < 0) return json(res, 404, { error: 'Confidential candidate not found.' })

      db.confidentialVault[idx].status = body.status || db.confidentialVault[idx].status
      saveDb(db)
      return json(res, 200, { success: true, candidate: db.confidentialVault[idx] })
    }

    /** Delete candidate */
    if (req.method === 'DELETE' && path.startsWith('/api/confidential/candidates/')) {
      const id = path.replace('/api/confidential/candidates/', '')
      const db = loadDb()
      db.confidentialVault = (db.confidentialVault || []).filter((c) => c.id !== id)
      saveDb(db)
      return json(res, 200, { success: true, deletedId: id })
    }

    /** Export all confidential vault data */
    if (req.method === 'GET' && path === '/api/confidential/export') {
      const db = loadDb()
      return json(res, 200, {
        exportedAt: new Date().toISOString(),
        total: (db.confidentialVault || []).length,
        candidates: db.confidentialVault || [],
      })
    }

    /** Confidential KPI metrics */
    if (req.method === 'GET' && path === '/api/confidential/stats') {
      const db = loadDb()
      const list = db.confidentialVault || []
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
    console.error(err)
    return json(res, 500, {
      error: err instanceof Error ? err.message : 'Server error',
    })
  }
})

await bootstrapDb()

server.listen(PORT, () => {
  console.log(`HIRERIGHT API v2 [${config.environment}] on http://localhost:${PORT}`)
  console.log(`Storage: ${config.databaseUrl ? 'PostgreSQL' : 'local db.json'}`)
  console.log(`Interview agent: ${llmConfigured() ? 'LLM enabled (Gemini)' : 'local adaptive agent (set GEMINI_API_KEY)'}`)
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
