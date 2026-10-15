import pg from 'pg'
import { applySchema } from './applySchema.mjs'

/** @typedef {{
 *   users: import('../index.mjs').User[],
 *   profiles: Record<string, unknown>,
 *   interviews: Record<string, unknown>,
 *   applications: Record<string, unknown[]>,
 *   interviewSessions: Record<string, unknown>,
 *   confidentialVault: unknown[],
 *   organizations: Organization[],
 *   organizationMembers: OrganizationMember[],
 *   organizationSubscriptions: OrganizationSubscription[],
 *   subscriptionPlans: SubscriptionPlan[],
 *   jobs: SaasJob[],
 *   employerApplications: EmployerApplication[],
 * }} DbShape */

/** @typedef {{
 *   id: string, name: string, slug: string, billingEmail?: string, status: string,
 *   settings?: Record<string, unknown>, logoUrl?: string, website?: string,
 *   createdAt: string, updatedAt: string,
 * }} Organization */

/** @typedef {{
 *   id: string, organizationId: string, userId: string, role: string,
 *   joinedAt: string, invitedByUserId?: string,
 * }} OrganizationMember */

/** @typedef {{
 *   id: string, organizationId: string, planId: string, status: string,
 *   trialEndsAt?: string, currentPeriodStart?: string, currentPeriodEnd?: string,
 *   stripeCustomerId?: string, stripeSubscriptionId?: string,
 *   createdAt: string, updatedAt: string,
 * }} OrganizationSubscription */

/** @typedef {{
 *   id: string, code: string, name: string, description?: string,
 *   priceCentsMonthly: number, priceCentsYearly: number, currency: string,
 *   limits: Record<string, unknown>, features: Record<string, unknown>,
 *   isPublic: boolean, sortOrder: number,
 * }} SubscriptionPlan */

/** @typedef {{
 *   id: string, organizationId: string, createdByUserId?: string,
 *   title: string, company: string, roleTrack?: string, experienceLevel?: string,
 *   location?: string, jobDescription?: string, requiredSkills?: string[],
 *   shareableCode: string, status?: string, createdAt: string, createdByEmail?: string,
 * }} SaasJob */

/** @typedef {{
 *   id: string, organizationId: string, jobId: string,
 *   candidateEmail: string, candidateUserId?: string, status: string,
 *   data: Record<string, unknown>, appliedAt: string,
 * }} EmployerApplication */

export function emptyDb() {
  return {
    users: [],
    profiles: {},
    interviews: {},
    applications: {},
    interviewSessions: {},
    confidentialVault: [],
    organizations: [],
    organizationMembers: [],
    organizationSubscriptions: [],
    subscriptionPlans: [],
    jobs: [],
    employerApplications: [],
  }
}

let pool = null
let schemaReady = null
let saveQueue = Promise.resolve()

function requireDatabaseUrl(databaseUrl) {
  if (!databaseUrl?.trim()) {
    throw new Error(
      'DATABASE_URL is required. Set Neon PostgreSQL in repo-root .env (see .env.example)',
    )
  }
  return databaseUrl.trim()
}

function pgSsl(databaseUrl) {
  if (/sslmode=require|neon\.tech|amazonaws\.com/i.test(databaseUrl)) {
    return { rejectUnauthorized: false }
  }
  return undefined
}

function getPool(databaseUrl) {
  const url = requireDatabaseUrl(databaseUrl)
  if (!pool) {
    pool = new pg.Pool({
      connectionString: url,
      ssl: pgSsl(url),
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
    })
  }
  return pool
}

async function ensurePgSchema(databaseUrl) {
  if (!schemaReady) schemaReady = (async () => {
    const client = await getPool(databaseUrl).connect()
    try { await applySchema(client) } finally { client.release() }
  })().catch(error => { schemaReady = null; throw error })
  await schemaReady
}

function userIdForEmail(db, email) {
  return db.users.find((u) => u.email === email)?.id || null
}

/** @param {import('pg').PoolClient} client */
async function loadRelational(client) {
  const db = emptyDb()

  const plansRes = await client.query(
    `SELECT id, code, name, description, price_cents_monthly, price_cents_yearly, currency,
            limits, features, is_public, sort_order
     FROM subscription_plans ORDER BY sort_order ASC`,
  )
  db.subscriptionPlans = plansRes.rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description || undefined,
    priceCentsMonthly: r.price_cents_monthly,
    priceCentsYearly: r.price_cents_yearly,
    currency: r.currency,
    limits: r.limits || {},
    features: r.features || {},
    isPublic: r.is_public,
    sortOrder: r.sort_order,
  }))

  const orgsRes = await client.query(
    `SELECT id, name, slug, logo_url, website, billing_email, status, settings, created_at, updated_at
     FROM organizations ORDER BY created_at ASC`,
  )
  db.organizations = orgsRes.rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    logoUrl: r.logo_url || undefined,
    website: r.website || undefined,
    billingEmail: r.billing_email || undefined,
    status: r.status,
    settings: r.settings || {},
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  }))

  const subsRes = await client.query(`SELECT * FROM organization_subscriptions`)
  db.organizationSubscriptions = subsRes.rows.map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    planId: r.plan_id,
    status: r.status,
    trialEndsAt: r.trial_ends_at ? iso(r.trial_ends_at) : undefined,
    currentPeriodStart: r.current_period_start ? iso(r.current_period_start) : undefined,
    currentPeriodEnd: r.current_period_end ? iso(r.current_period_end) : undefined,
    stripeCustomerId: r.stripe_customer_id || undefined,
    stripeSubscriptionId: r.stripe_subscription_id || undefined,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  }))

  const usersRes = await client.query(
    `SELECT id, email, name, password_hash, role, company_name, primary_organization_id, status, phone, created_at
     FROM users ORDER BY created_at ASC`,
  )
  db.users = usersRes.rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    passwordHash: r.password_hash,
    role: r.role || undefined,
    companyName: r.company_name || undefined,
    primaryOrganizationId: r.primary_organization_id || undefined,
    status: r.status || 'active',
    phone: r.phone || undefined,
    createdAt: iso(r.created_at),
  }))

  const membersRes = await client.query(`SELECT * FROM organization_members`)
  db.organizationMembers = membersRes.rows.map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    userId: r.user_id,
    role: r.role,
    invitedByUserId: r.invited_by_user_id || undefined,
    joinedAt: iso(r.joined_at),
  }))

  const jobsRes = await client.query(`SELECT * FROM jobs ORDER BY created_at DESC`)
  db.jobs = jobsRes.rows.map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    createdByUserId: r.created_by_user_id || undefined,
    title: r.title,
    company: r.company,
    roleTrack: r.role_track || '',
    experienceLevel: r.experience_level || '',
    location: r.location || '',
    jobDescription: r.job_description || '',
    requiredSkills: r.required_skills || [],
    shareableCode: r.shareable_code,
    status: r.status,
    createdAt: iso(r.created_at),
    createdByEmail:
      (typeof r.extras === 'object' && r.extras && r.extras.createdByEmail) || '',
  }))

  const empAppsRes = await client.query(`SELECT * FROM employer_applications ORDER BY applied_at DESC`)
  db.employerApplications = empAppsRes.rows.map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    jobId: r.job_id,
    candidateEmail: r.candidate_email,
    candidateUserId: r.candidate_user_id || undefined,
    status: r.status,
    data: r.data || {},
    appliedAt: iso(r.applied_at),
  }))

  const profilesRes = await client.query('SELECT email, data FROM profiles')
  for (const row of profilesRes.rows) {
    db.profiles[row.email] = row.data
  }

  const interviewsRes = await client.query('SELECT email, data FROM interview_results')
  for (const row of interviewsRes.rows) {
    db.interviews[row.email] = row.data
  }

  const appsRes = await client.query(
    'SELECT email, id, data FROM job_applications ORDER BY created_at ASC',
  )
  for (const row of appsRes.rows) {
    if (!db.applications[row.email]) db.applications[row.email] = []
    db.applications[row.email].push(row.data)
  }

  const sessionsRes = await client.query('SELECT session_id, data FROM interview_sessions')
  for (const row of sessionsRes.rows) {
    db.interviewSessions[row.session_id] = row.data
  }

  const vaultRes = await client.query(
    `SELECT id, organization_id, data FROM confidential_candidates
     ORDER BY sort_order ASC, created_at DESC`,
  )
  db.confidentialVault = vaultRes.rows.map((r) => ({
    ...(typeof r.data === 'object' && r.data ? r.data : {}),
    id: r.id,
    organizationId: r.organization_id,
  }))

  return db
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : String(value)
}

/** @param {import('pg').PoolClient} client @param {DbShape} db */
async function saveRelational(client, db) {
  await client.query('BEGIN')
  try {
    for (const org of db.organizations || []) {
      await client.query(
        `INSERT INTO organizations (id, name, slug, logo_url, website, billing_email, status, settings, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::timestamptz,$10::timestamptz)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, slug = EXCLUDED.slug, logo_url = EXCLUDED.logo_url,
           website = EXCLUDED.website, billing_email = EXCLUDED.billing_email,
           status = EXCLUDED.status, settings = EXCLUDED.settings, updated_at = EXCLUDED.updated_at`,
        [
          org.id,
          org.name,
          org.slug,
          org.logoUrl || null,
          org.website || null,
          org.billingEmail || null,
          org.status || 'active',
          JSON.stringify(org.settings || {}),
          org.createdAt || new Date().toISOString(),
          org.updatedAt || new Date().toISOString(),
        ],
      )
    }

    for (const sub of db.organizationSubscriptions || []) {
      await client.query(
        `INSERT INTO organization_subscriptions
           (id, organization_id, plan_id, status, stripe_customer_id, stripe_subscription_id,
            trial_ends_at, current_period_start, current_period_end, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9::timestamptz,$10::timestamptz,$11::timestamptz)
         ON CONFLICT (organization_id) DO UPDATE SET
           plan_id = EXCLUDED.plan_id, status = EXCLUDED.status,
           trial_ends_at = EXCLUDED.trial_ends_at, updated_at = EXCLUDED.updated_at,
           stripe_customer_id = EXCLUDED.stripe_customer_id, stripe_subscription_id = EXCLUDED.stripe_subscription_id,
           current_period_start = EXCLUDED.current_period_start, current_period_end = EXCLUDED.current_period_end`,
        [
          sub.id,
          sub.organizationId,
          sub.planId,
          sub.status,
          sub.stripeCustomerId || null,
          sub.stripeSubscriptionId || null,
          sub.trialEndsAt || null,
          sub.currentPeriodStart || null,
          sub.currentPeriodEnd || null,
          sub.createdAt || new Date().toISOString(),
          sub.updatedAt || new Date().toISOString(),
        ],
      )
    }

    for (const u of db.users || []) {
      await client.query(
        `INSERT INTO users (id, email, name, password_hash, role, company_name, primary_organization_id, status, phone, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz)
         ON CONFLICT (email) DO UPDATE SET
           name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role,
           company_name = EXCLUDED.company_name, primary_organization_id = EXCLUDED.primary_organization_id,
           status = EXCLUDED.status, phone = COALESCE(EXCLUDED.phone, users.phone)`,
        [
          u.id,
          u.email,
          u.name,
          u.passwordHash,
          u.role || 'jobseeker',
          u.companyName || null,
          u.primaryOrganizationId || null,
          u.status || 'active',
          u.phone || null,
          u.createdAt || new Date().toISOString(),
        ],
      )
    }

    for (const m of db.organizationMembers || []) {
      await client.query(
        `INSERT INTO organization_members (id, organization_id, user_id, role, invited_by_user_id, joined_at)
         VALUES ($1,$2,$3,$4,$5,$6::timestamptz)
         ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [
          m.id,
          m.organizationId,
          m.userId,
          m.role,
          m.invitedByUserId || null,
          m.joinedAt || new Date().toISOString(),
        ],
      )
    }

    // Do not delete/reinsert retained jobs: ON DELETE SET NULL destroys history links.
    await client.query('DELETE FROM jobs WHERE NOT (id = ANY($1::text[]))', [(db.jobs || []).map(job => job.id)])
    for (const job of db.jobs || []) {
      const extras = { createdByEmail: job.createdByEmail || '' }
      await client.query(
        `INSERT INTO jobs (
           id, organization_id, created_by_user_id, title, company, role_track, experience_level,
           location, job_description, required_skills, shareable_code, status, extras, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13::jsonb,$14::timestamptz,$15::timestamptz)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title, company = EXCLUDED.company, job_description = EXCLUDED.job_description,
           required_skills = EXCLUDED.required_skills, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at,
           role_track = EXCLUDED.role_track, experience_level = EXCLUDED.experience_level,
           location = EXCLUDED.location, shareable_code = EXCLUDED.shareable_code, extras = EXCLUDED.extras`,
        [
          job.id,
          job.organizationId,
          job.createdByUserId || null,
          job.title,
          job.company,
          job.roleTrack || null,
          job.experienceLevel || null,
          job.location || null,
          job.jobDescription || null,
          JSON.stringify(job.requiredSkills || []),
          job.shareableCode,
          job.status || 'published',
          JSON.stringify(extras),
          job.createdAt || new Date().toISOString(),
          new Date().toISOString(),
        ],
      )
    }

    await client.query('DELETE FROM employer_applications')
    for (const app of db.employerApplications || []) {
      await client.query(
        `INSERT INTO employer_applications
           (id, organization_id, job_id, candidate_user_id, candidate_email, status, data, applied_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz)`,
        [
          app.id,
          app.organizationId,
          app.jobId,
          app.candidateUserId || null,
          app.candidateEmail,
          app.status || 'new',
          JSON.stringify(app.data || {}),
          app.appliedAt || new Date().toISOString(),
        ],
      )
    }

    for (const email of Object.keys(db.profiles || {})) {
      await client.query(
        `INSERT INTO profiles (email, user_id, data, updated_at)
         VALUES ($1, $2, $3::jsonb, NOW())
         ON CONFLICT (email) DO UPDATE SET user_id = EXCLUDED.user_id, data = EXCLUDED.data, updated_at = NOW()`,
        [email, userIdForEmail(db, email), JSON.stringify(db.profiles[email])],
      )
    }

    for (const email of Object.keys(db.interviews || {})) {
      const payload = db.interviews[email]
      const overall =
        typeof payload === 'object' && payload && 'overall' in payload
          ? Number(/** @type {{ overall?: number }} */ (payload).overall) || 0
          : null
      await client.query(
        `INSERT INTO interview_results (email, user_id, overall, data, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, NOW())
         ON CONFLICT (email) DO UPDATE SET user_id = EXCLUDED.user_id, overall = EXCLUDED.overall, data = EXCLUDED.data, updated_at = NOW()`,
        [email, userIdForEmail(db, email), overall, JSON.stringify(payload)],
      )
    }

    await client.query('DELETE FROM job_applications')
    for (const [email, list] of Object.entries(db.applications || {})) {
      if (!Array.isArray(list)) continue
      for (const item of list) {
        const id = String(item?.id || item?.jobId || randomAppId())
        await client.query(
          `INSERT INTO job_applications (id, email, data, created_at)
           VALUES ($1, $2, $3::jsonb, COALESCE($4::timestamptz, NOW()))`,
          [id, email, JSON.stringify(item), item?.appliedAt || item?.createdAt || null],
        )
      }
    }

    for (const [sessionId, data] of Object.entries(db.interviewSessions || {})) {
      const email = String(/** @type {{ email?: string }} */ (data)?.email || '')
      await client.query(
        `INSERT INTO interview_sessions (session_id, email, user_id, data, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, NOW())
         ON CONFLICT (session_id) DO UPDATE SET email = EXCLUDED.email, data = EXCLUDED.data, updated_at = NOW()`,
        [sessionId, email || 'unknown@local', userIdForEmail(db, email), JSON.stringify(data)],
      )
    }

    await client.query('DELETE FROM confidential_candidates')
    const vault = db.confidentialVault || []
    for (let i = 0; i < vault.length; i++) {
      const item = vault[i]
      const id = String(/** @type {{ id?: string }} */ (item)?.id || `conf-${i}`)
      const orgId =
        String(/** @type {{ organizationId?: string }} */ (item)?.organizationId || '') ||
        'org-platform'
      const { organizationId: _o, id: _i, ...rest } =
        typeof item === 'object' && item ? /** @type {Record<string, unknown>} */ (item) : {}
      await client.query(
        `INSERT INTO confidential_candidates (id, organization_id, data, sort_order, created_at)
         VALUES ($1, $2, $3::jsonb, $4, COALESCE($5::timestamptz, NOW()))`,
        [
          id,
          orgId,
          JSON.stringify(rest),
          i,
          /** @type {{ createdAt?: string }} */ (item)?.createdAt || null,
        ],
      )
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  }
}

function randomAppId() {
  return `app-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export async function loadDb(databaseUrl) {
  requireDatabaseUrl(databaseUrl)
  await ensurePgSchema(databaseUrl)
  const client = await getPool(databaseUrl).connect()
  try {
    return await loadRelational(client)
  } finally {
    client.release()
  }
}

export async function saveDb(db, databaseUrl) {
  requireDatabaseUrl(databaseUrl)
  const snapshot = structuredClone(db)
  const pending = saveQueue.then(async () => {
    await ensurePgSchema(databaseUrl)
    const client = await getPool(databaseUrl).connect()
    try { await saveRelational(client, snapshot) } finally { client.release() }
  })
  saveQueue = pending.catch(() => {})
  return pending
}

export async function pingDatabase(databaseUrl) {
  try {
    requireDatabaseUrl(databaseUrl)
    const res = await getPool(databaseUrl).query('SELECT 1 AS ok')
    return { ok: res.rows[0]?.ok === 1 }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

export async function saveSessionToken(databaseUrl, token, email, ttlMs = 7 * 24 * 60 * 60 * 1000) {
  requireDatabaseUrl(databaseUrl)
  const expires = new Date(Date.now() + ttlMs)
  await getPool(databaseUrl).query(
    `INSERT INTO hireright_sessions (token, email, expires_at) VALUES ($1, $2, $3)
     ON CONFLICT (token) DO UPDATE SET email = EXCLUDED.email, expires_at = EXCLUDED.expires_at`,
    [token, email, expires.toISOString()],
  )
}

export async function resolveSessionEmail(databaseUrl, token) {
  if (!token) return null
  requireDatabaseUrl(databaseUrl)
  const res = await getPool(databaseUrl).query(
    'SELECT email FROM hireright_sessions WHERE token = $1 AND expires_at > NOW()',
    [token],
  )
  return res.rows[0]?.email || null
}

export async function deleteSessionToken(databaseUrl, token) {
  if (!token) return
  requireDatabaseUrl(databaseUrl)
  await getPool(databaseUrl).query('DELETE FROM hireright_sessions WHERE token = $1', [token])
}

export async function appendInterviewHistory(databaseUrl, email, data, ctx = {}) {
  if (!email || !data) return
  requireDatabaseUrl(databaseUrl)
  const overall =
    typeof data === 'object' && data && 'overall' in data
      ? Number(/** @type {{ overall?: number }} */ (data).overall) || 0
      : null
  await getPool(databaseUrl).query(
    `INSERT INTO interview_result_history (email, user_id, organization_id, job_id, overall, data)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      email,
      ctx.userId || null,
      ctx.organizationId || null,
      ctx.jobId || null,
      overall,
      JSON.stringify(data),
    ],
  )
}

export async function closeStore() {
  await saveQueue
  if (pool) await pool.end()
  pool = null
  schemaReady = null
}
