import pg from 'pg'
import { applySchema } from './applySchema.mjs'
import { resolvePgHost } from './resolvePgHost.mjs'

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
/** @type {Promise<import('pg').Pool> | null} */
let poolInit = null
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

function poolConfigFromUrl(url, resolved) {
  const base = {
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
  }
  const sslBase = pgSsl(url)
  if (!resolved.servername) {
    return {
      ...base,
      connectionString: url,
      ssl: sslBase,
    }
  }
  const parsed = new URL(url)
  const ssl = sslBase ? { ...sslBase, servername: resolved.servername } : undefined
  return {
    ...base,
    host: resolved.host,
    port: Number(parsed.port || 5432),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    ssl,
  }
}

async function ensurePool(databaseUrl) {
  const url = requireDatabaseUrl(databaseUrl)
  if (pool) return pool
  if (!poolInit) {
    poolInit = (async () => {
      const parsed = new URL(url)
      const resolved = await resolvePgHost(parsed.hostname)
      if (resolved.servername) {
        console.log(`[dns] Resolved ${parsed.hostname} → ${resolved.host} (public DNS)`)
      }
      const cfg = poolConfigFromUrl(url, resolved)
      const next = new pg.Pool(cfg)
      next.on('error', (err) => {
        console.warn('[db] pool idle client error (Neon reconnect):', err?.message || err)
      })
      pool = next
      return next
    })().catch((err) => {
      poolInit = null
      throw err
    })
  }
  return poolInit
}

function getPool(databaseUrl) {
  requireDatabaseUrl(databaseUrl)
  if (!pool) {
    throw new Error('Database pool not ready — bootstrapDb must complete first')
  }
  return pool
}

async function ensurePgSchema(databaseUrl) {
  if (!schemaReady) schemaReady = (async () => {
    await ensurePool(databaseUrl)
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
  db.jobs = jobsRes.rows.map((r) => mapJobRow(r))

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

/** @param {import('pg').QueryResultRow} r */
function mapJobRow(r) {
  const extras = typeof r.extras === 'object' && r.extras ? r.extras : {}
  return {
    id: r.id,
    organizationId: r.organization_id,
    createdByUserId: r.created_by_user_id || undefined,
    title: r.title,
    company: r.company,
    companySlug: extras.companySlug || undefined,
    roleTrack: r.role_track || '',
    experienceLevel: r.experience_level || '',
    location: r.location || '',
    jobDescription: r.job_description || '',
    requiredSkills: r.required_skills || [],
    shareableCode: r.shareable_code,
    status: r.status,
    createdAt: iso(r.created_at),
    createdByEmail: extras.createdByEmail || '',
  }
}

/** Merge all jobs for one employer org from Postgres (vendor dashboard). */
export async function syncOrgJobsFromDatabase(databaseUrl, db, organizationId) {
  const orgId = String(organizationId || '').trim()
  if (!databaseUrl?.trim() || !orgId) return db
  await ensurePgSchema(databaseUrl)
  const res = await getPool(databaseUrl).query(
    `SELECT * FROM jobs
     WHERE organization_id = $1
       AND COALESCE(status, 'published') NOT IN ('archived', 'deleted')
     ORDER BY created_at DESC`,
    [orgId],
  )
  const fromPg = res.rows.map((r) => mapJobRow(r))
  const byId = new Map((db.jobs || []).map((j) => [j.id, j]))
  for (const job of fromPg) {
    byId.set(job.id, { ...byId.get(job.id), ...job })
  }
  db.jobs = [...byId.values()]
  return db
}

/** Merge active/published jobs from Postgres into the in-memory db (candidate job board). */
export async function syncOpenJobsFromDatabase(databaseUrl, db) {
  if (!databaseUrl?.trim()) return db
  await ensurePgSchema(databaseUrl)
  const res = await getPool(databaseUrl).query(
    `SELECT * FROM jobs
     WHERE COALESCE(status, 'published') IN ('active', 'published')
     ORDER BY created_at DESC`,
  )
  const fromPg = res.rows.map((r) => mapJobRow(r))
  const byId = new Map((db.jobs || []).map((j) => [j.id, j]))
  for (const job of fromPg) {
    byId.set(job.id, { ...byId.get(job.id), ...job })
  }
  db.jobs = [...byId.values()]
  return db
}

/** Direct Postgres lookup for public share links (authoritative when cache is stale). */
export async function findJobByShareableCode(databaseUrl, shareableCode) {
  const code = String(shareableCode || '').trim().toLowerCase()
  if (!code) return null
  await ensurePgSchema(databaseUrl)
  const res = await getPool(databaseUrl).query(
    `SELECT * FROM jobs
     WHERE LOWER(shareable_code) = $1
       AND COALESCE(status, 'published') IN ('active', 'published')
     LIMIT 1`,
    [code],
  )
  return res.rows[0] ? mapJobRow(res.rows[0]) : null
}

/** Persist one job row immediately so share links work before the next full save. */
/** Delete one employer job row (applications cascade in Postgres). */
export async function deleteJobRecord(databaseUrl, jobId, organizationId) {
  const id = String(jobId || '').trim()
  const orgId = String(organizationId || '').trim()
  if (!id || !orgId) return false
  await ensurePgSchema(databaseUrl)
  const res = await getPool(databaseUrl).query(
    `DELETE FROM jobs WHERE id = $1 AND organization_id = $2`,
    [id, orgId],
  )
  return (res.rowCount ?? 0) > 0
}

/** Merge employer applications from Postgres (multi-instance / fresh vendor dashboard). */
export async function syncEmployerApplicationsFromDatabase(databaseUrl, db) {
  if (!databaseUrl?.trim()) return db
  await ensurePgSchema(databaseUrl)
  const res = await getPool(databaseUrl).query(
    `SELECT * FROM employer_applications ORDER BY applied_at DESC`,
  )
  const fromPg = res.rows.map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    jobId: r.job_id,
    candidateEmail: r.candidate_email,
    candidateUserId: r.candidate_user_id || undefined,
    status: r.status,
    data: r.data || {},
    appliedAt: iso(r.applied_at),
  }))
  const byId = new Map((db.employerApplications || []).map((a) => [a.id, a]))
  for (const app of fromPg) {
    byId.set(app.id, { ...byId.get(app.id), ...app })
  }
  db.employerApplications = [...byId.values()]
  return db
}

export async function upsertJobApplicationRecord(databaseUrl, email, record) {
  if (!databaseUrl?.trim() || !email || !record?.id) return
  await ensurePgSchema(databaseUrl)
  const appliedAt = record.appliedAt || new Date().toISOString()
  await getPool(databaseUrl).query(
    `INSERT INTO job_applications (id, email, data, created_at)
     VALUES ($1, $2, $3::jsonb, $4::timestamptz)
     ON CONFLICT (email, id) DO UPDATE SET
       data = EXCLUDED.data,
       created_at = EXCLUDED.created_at`,
    [record.id, String(email).trim().toLowerCase(), JSON.stringify(record), appliedAt],
  )
}

export async function markJobApplicationsDeletedInPostgres(databaseUrl, jobId, patch = {}) {
  const id = String(jobId || '').trim()
  if (!databaseUrl?.trim() || !id) return 0
  await ensurePgSchema(databaseUrl)
  const merged = {
    jobStatus: 'deleted',
    jobDeletedAt: patch.jobDeletedAt || new Date().toISOString(),
    jobDeletedMessage: patch.jobDeletedMessage || 'This job was removed by the employer.',
  }
  const res = await getPool(databaseUrl).query(
    `UPDATE job_applications
     SET data = COALESCE(data, '{}'::jsonb) || $2::jsonb
     WHERE data->>'jobId' = $1`,
    [id, JSON.stringify(merged)],
  )
  return res.rowCount || 0
}

export async function deleteJobApplicationRecord(databaseUrl, email, applicationId) {
  if (!databaseUrl?.trim() || !email || !applicationId) return
  await ensurePgSchema(databaseUrl)
  await getPool(databaseUrl).query(
    `DELETE FROM job_applications WHERE lower(email) = lower($1) AND id = $2`,
    [email, applicationId],
  )
}

/** @param {string} email */
export async function loadJobApplicationsForEmail(databaseUrl, email) {
  if (!databaseUrl?.trim() || !email) return []
  await ensurePgSchema(databaseUrl)
  const res = await getPool(databaseUrl).query(
    `SELECT id, data, created_at FROM job_applications
     WHERE lower(email) = lower($1)
     ORDER BY created_at DESC`,
    [email],
  )
  return res.rows.map((row) => {
    const data = row.data && typeof row.data === 'object' ? row.data : {}
    return {
      ...data,
      id: String(row.id || data.id || ''),
      appliedAt: data.appliedAt || (row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at),
    }
  })
}

export async function upsertEmployerApplicationRecord(databaseUrl, app) {
  if (!databaseUrl?.trim() || !app?.id) return
  await ensurePgSchema(databaseUrl)
  await getPool(databaseUrl).query(
    `INSERT INTO employer_applications
       (id, organization_id, job_id, candidate_user_id, candidate_email, status, data, applied_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz)
     ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, data=EXCLUDED.data,
       candidate_user_id=EXCLUDED.candidate_user_id, candidate_email=EXCLUDED.candidate_email`,
    [
      app.id,
      app.organizationId,
      app.jobId,
      app.candidateUserId || null,
      app.candidateEmail,
      app.status || 'applied',
      JSON.stringify(app.data || {}),
      app.appliedAt || new Date().toISOString(),
    ],
  )
}

export async function upsertJobRecord(databaseUrl, job) {
  if (!job?.id || !job.shareableCode) return
  await ensurePgSchema(databaseUrl)
  const extras = {
    createdByEmail: job.createdByEmail || '',
    companySlug: job.companySlug || null,
  }
  await getPool(databaseUrl).query(
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

/**
 * Last row wins per conflict key — Postgres rejects one INSERT … ON CONFLICT that touches a row twice.
 * @template T @param {T[]} rows @param {(row: T) => string} keyOf
 */
function dedupeBy(rows, keyOf) {
  const byKey = new Map()
  for (const row of rows) byKey.set(keyOf(row), row)
  return [...byKey.values()]
}

/**
 * table → (row key → row JSON) as of the last committed save. Saves only send rows that differ,
 * because every Neon round-trip costs ~0.3s and full rewrites took 25s+ per request.
 * @type {Map<string, Map<string, string>>}
 */
let persistedRows = new Map()

/**
 * @param {Map<string, Map<string, string>>} next
 * @param {string} table @param {Record<string, unknown>[]} rows @param {(row: any) => string} keyOf
 */
function diffRows(next, table, rows, keyOf) {
  const prev = persistedRows.get(table)
  const current = new Map()
  for (const row of rows) current.set(keyOf(row), JSON.stringify(row))
  next.set(table, current)
  const changed = rows.filter((row) => prev?.get(keyOf(row)) !== current.get(keyOf(row)))
  const removed = prev ? [...prev.keys()].some((key) => !current.has(key)) : true
  return { rows, changed, removed }
}

const recordset = (rows) => [JSON.stringify(rows)]

/** @param {import('pg').PoolClient} client @param {DbShape} db */
async function saveRelational(client, db) {
  /** @type {Map<string, Map<string, string>>} */
  const next = new Map()
  /** @type {[string, unknown[]][]} */
  const statements = []

  const orgs = diffRows(
    next,
    'organizations',
    dedupeBy(db.organizations || [], (o) => o.id).map((org) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      logo_url: org.logoUrl || null,
      website: org.website || null,
      billing_email: org.billingEmail || null,
      status: org.status || 'active',
      settings: org.settings || {},
      created_at: org.createdAt || null,
      updated_at: org.updatedAt || null,
    })),
    (r) => r.id,
  )
  if (orgs.changed.length) {
    statements.push([
      `INSERT INTO organizations (id, name, slug, logo_url, website, billing_email, status, settings, created_at, updated_at)
       SELECT id, name, slug, logo_url, website, billing_email, status, settings,
         COALESCE(created_at, NOW()), COALESCE(updated_at, NOW())
       FROM jsonb_to_recordset($1::jsonb) AS x(id text, name text, slug text, logo_url text, website text,
         billing_email text, status text, settings jsonb, created_at timestamptz, updated_at timestamptz)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, slug = EXCLUDED.slug, logo_url = EXCLUDED.logo_url,
         website = EXCLUDED.website, billing_email = EXCLUDED.billing_email,
         status = EXCLUDED.status, settings = EXCLUDED.settings, updated_at = EXCLUDED.updated_at`,
      recordset(orgs.changed),
    ])
  }

  const subs = diffRows(
    next,
    'organization_subscriptions',
    dedupeBy(db.organizationSubscriptions || [], (s) => s.organizationId).map((sub) => ({
      id: sub.id,
      organization_id: sub.organizationId,
      plan_id: sub.planId,
      status: sub.status,
      stripe_customer_id: sub.stripeCustomerId || null,
      stripe_subscription_id: sub.stripeSubscriptionId || null,
      trial_ends_at: sub.trialEndsAt || null,
      current_period_start: sub.currentPeriodStart || null,
      current_period_end: sub.currentPeriodEnd || null,
      created_at: sub.createdAt || null,
      updated_at: sub.updatedAt || null,
    })),
    (r) => r.organization_id,
  )
  if (subs.changed.length) {
    statements.push([
      `INSERT INTO organization_subscriptions
         (id, organization_id, plan_id, status, stripe_customer_id, stripe_subscription_id,
          trial_ends_at, current_period_start, current_period_end, created_at, updated_at)
       SELECT id, organization_id, plan_id, status, stripe_customer_id, stripe_subscription_id,
          trial_ends_at, current_period_start, current_period_end,
          COALESCE(created_at, NOW()), COALESCE(updated_at, NOW())
       FROM jsonb_to_recordset($1::jsonb) AS x(id text, organization_id text, plan_id text, status text,
         stripe_customer_id text, stripe_subscription_id text, trial_ends_at timestamptz,
         current_period_start timestamptz, current_period_end timestamptz, created_at timestamptz, updated_at timestamptz)
       ON CONFLICT (organization_id) DO UPDATE SET
         plan_id = EXCLUDED.plan_id, status = EXCLUDED.status,
         trial_ends_at = EXCLUDED.trial_ends_at, updated_at = EXCLUDED.updated_at,
         stripe_customer_id = EXCLUDED.stripe_customer_id, stripe_subscription_id = EXCLUDED.stripe_subscription_id,
         current_period_start = EXCLUDED.current_period_start, current_period_end = EXCLUDED.current_period_end`,
      recordset(subs.changed),
    ])
  }

  const users = diffRows(
    next,
    'users',
    dedupeBy(db.users || [], (u) => u.email).map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      password_hash: u.passwordHash,
      role: u.role || 'jobseeker',
      company_name: u.companyName || null,
      primary_organization_id: u.primaryOrganizationId || null,
      status: u.status || 'active',
      phone: u.phone || null,
      created_at: u.createdAt || null,
    })),
    (r) => r.email,
  )
  if (users.changed.length) {
    statements.push([
      `INSERT INTO users (id, email, name, password_hash, role, company_name, primary_organization_id, status, phone, created_at)
       SELECT id, email, name, password_hash, role, company_name, primary_organization_id, status, phone,
         COALESCE(created_at, NOW())
       FROM jsonb_to_recordset($1::jsonb) AS x(id text, email text, name text, password_hash text, role text,
         company_name text, primary_organization_id text, status text, phone text, created_at timestamptz)
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role,
         company_name = EXCLUDED.company_name, primary_organization_id = EXCLUDED.primary_organization_id,
         status = EXCLUDED.status, phone = COALESCE(EXCLUDED.phone, users.phone)
       WHERE users.id = EXCLUDED.id`,
      recordset(users.changed),
    ])
  }

  const members = diffRows(
    next,
    'organization_members',
    dedupeBy(db.organizationMembers || [], (m) => `${m.organizationId}\u0000${m.userId}`).map((m) => ({
      id: m.id,
      organization_id: m.organizationId,
      user_id: m.userId,
      role: m.role,
      invited_by_user_id: m.invitedByUserId || null,
      joined_at: m.joinedAt || null,
    })),
    (r) => `${r.organization_id}\u0000${r.user_id}`,
  )
  if (members.changed.length) {
    statements.push([
      `INSERT INTO organization_members (id, organization_id, user_id, role, invited_by_user_id, joined_at)
       SELECT id, organization_id, user_id, role, invited_by_user_id, COALESCE(joined_at, NOW())
       FROM jsonb_to_recordset($1::jsonb) AS x(id text, organization_id text, user_id text, role text,
         invited_by_user_id text, joined_at timestamptz)
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      recordset(members.changed),
    ])
  }

  const jobs = diffRows(
    next,
    'jobs',
    dedupeBy(db.jobs || [], (j) => j.id).map((job) => ({
      id: job.id,
      organization_id: job.organizationId,
      created_by_user_id: job.createdByUserId || null,
      title: job.title,
      company: job.company,
      role_track: job.roleTrack || null,
      experience_level: job.experienceLevel || null,
      location: job.location || null,
      job_description: job.jobDescription || null,
      required_skills: job.requiredSkills || [],
      shareable_code: job.shareableCode,
      status: job.status || 'published',
      extras: { createdByEmail: job.createdByEmail || '', companySlug: job.companySlug || null },
      created_at: job.createdAt || null,
    })),
    (r) => r.id,
  )
  // Do not delete/reinsert retained jobs: ON DELETE SET NULL destroys history links.
  const jobIds = jobs.rows.map((job) => job.id).filter(Boolean)
  if (jobs.removed && jobIds.length) {
    statements.push(['DELETE FROM jobs WHERE NOT (id = ANY($1::text[]))', [jobIds]])
  }
  if (jobs.changed.length) {
    statements.push([
      `INSERT INTO jobs (
         id, organization_id, created_by_user_id, title, company, role_track, experience_level,
         location, job_description, required_skills, shareable_code, status, extras, created_at, updated_at
       )
       SELECT id, organization_id, created_by_user_id, title, company, role_track, experience_level,
         location, job_description, required_skills, shareable_code, status, extras, COALESCE(created_at, NOW()), NOW()
       FROM jsonb_to_recordset($1::jsonb) AS x(id text, organization_id text, created_by_user_id text,
         title text, company text, role_track text, experience_level text, location text, job_description text,
         required_skills jsonb, shareable_code text, status text, extras jsonb, created_at timestamptz)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title, company = EXCLUDED.company, job_description = EXCLUDED.job_description,
         required_skills = EXCLUDED.required_skills, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at,
         role_track = EXCLUDED.role_track, experience_level = EXCLUDED.experience_level,
         location = EXCLUDED.location, shareable_code = EXCLUDED.shareable_code, extras = EXCLUDED.extras`,
      recordset(jobs.changed),
    ])
  }

  const empApps = diffRows(
    next,
    'employer_applications',
    dedupeBy(db.employerApplications || [], (a) => a.id).map((app) => ({
      id: app.id,
      organization_id: app.organizationId,
      job_id: app.jobId,
      candidate_user_id: app.candidateUserId || null,
      candidate_email: app.candidateEmail,
      status: app.status || 'new',
      data: app.data || {},
      applied_at: app.appliedAt || null,
    })),
    (r) => r.id,
  )
  if (empApps.removed) {
    statements.push([
      'DELETE FROM employer_applications WHERE NOT (id = ANY($1::text[]))',
      [empApps.rows.map((app) => app.id)],
    ])
  }
  if (empApps.changed.length) {
    statements.push([
      `INSERT INTO employer_applications
         (id, organization_id, job_id, candidate_user_id, candidate_email, status, data, applied_at)
       SELECT id, organization_id, job_id, candidate_user_id, candidate_email, status, data, COALESCE(applied_at, NOW())
       FROM jsonb_to_recordset($1::jsonb) AS x(id text, organization_id text, job_id text,
         candidate_user_id text, candidate_email text, status text, data jsonb, applied_at timestamptz)
       ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, data=EXCLUDED.data,
         candidate_user_id=EXCLUDED.candidate_user_id`,
      recordset(empApps.changed),
    ])
  }

  const profiles = diffRows(
    next,
    'profiles',
    Object.keys(db.profiles || {}).map((email) => ({
      email,
      user_id: userIdForEmail(db, email),
      data: db.profiles[email] ?? null,
    })),
    (r) => r.email,
  )
  if (profiles.changed.length) {
    statements.push([
      `INSERT INTO profiles (email, user_id, data, updated_at)
       SELECT email, user_id, data, NOW()
       FROM jsonb_to_recordset($1::jsonb) AS x(email text, user_id text, data jsonb)
       ON CONFLICT (email) DO UPDATE SET user_id = EXCLUDED.user_id, data = EXCLUDED.data, updated_at = NOW()`,
      recordset(profiles.changed),
    ])
  }

  const results = diffRows(
    next,
    'interview_results',
    Object.keys(db.interviews || {}).map((email) => {
      const payload = db.interviews[email]
      const overall =
        typeof payload === 'object' && payload && 'overall' in payload
          ? Number(/** @type {{ overall?: number }} */ (payload).overall) || 0
          : null
      return { email, user_id: userIdForEmail(db, email), overall, data: payload ?? null }
    }),
    (r) => r.email,
  )
  if (results.changed.length) {
    statements.push([
      `INSERT INTO interview_results (email, user_id, overall, data, updated_at)
       SELECT email, user_id, round(overall)::int, data, NOW()
       FROM jsonb_to_recordset($1::jsonb) AS x(email text, user_id text, overall numeric, data jsonb)
       ON CONFLICT (email) DO UPDATE SET user_id = EXCLUDED.user_id, overall = EXCLUDED.overall, data = EXCLUDED.data, updated_at = NOW()`,
      recordset(results.changed),
    ])
  }

  const appRows = []
  for (const [email, list] of Object.entries(db.applications || {})) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      appRows.push({
        id: String(item?.id || item?.jobId || randomAppId()),
        email,
        data: item ?? null,
        created_at: item?.appliedAt || item?.createdAt || null,
      })
    }
  }
  const apps = diffRows(next, 'job_applications', dedupeBy(appRows, (r) => `${r.email}\u0000${r.id}`), (r) => `${r.email}\u0000${r.id}`)
  if (apps.removed || apps.changed.length) {
    statements.push(['DELETE FROM job_applications', []])
    if (apps.rows.length) {
      statements.push([
        `INSERT INTO job_applications (id, email, data, created_at)
         SELECT id, email, data, COALESCE(created_at, NOW())
         FROM jsonb_to_recordset($1::jsonb) AS x(id text, email text, data jsonb, created_at timestamptz)`,
        recordset(apps.rows),
      ])
    }
  }

  const sessions = diffRows(
    next,
    'interview_sessions',
    Object.entries(db.interviewSessions || {}).map(([sessionId, data]) => {
      const email = String(/** @type {{ email?: string }} */ (data)?.email || '')
      return {
        session_id: sessionId,
        email: email || 'unknown@local',
        user_id: userIdForEmail(db, email),
        data: data ?? null,
      }
    }),
    (r) => r.session_id,
  )
  if (sessions.changed.length) {
    statements.push([
      `INSERT INTO interview_sessions (session_id, email, user_id, data, updated_at)
       SELECT session_id, email, user_id, data, NOW()
       FROM jsonb_to_recordset($1::jsonb) AS x(session_id text, email text, user_id text, data jsonb)
       ON CONFLICT (session_id) DO UPDATE SET email = EXCLUDED.email, data = EXCLUDED.data, updated_at = NOW()`,
      recordset(sessions.changed),
    ])
  }

  const vaultRows = (db.confidentialVault || []).map((item, i) => {
    const { organizationId: _o, id: _i, ...rest } =
      typeof item === 'object' && item ? /** @type {Record<string, unknown>} */ (item) : {}
    return {
      id: String(/** @type {{ id?: string }} */ (item)?.id || `conf-${i}`),
      organization_id:
        String(/** @type {{ organizationId?: string }} */ (item)?.organizationId || '') || 'org-platform',
      data: rest,
      sort_order: i,
      created_at: /** @type {{ createdAt?: string }} */ (item)?.createdAt || null,
    }
  })
  const vault = diffRows(next, 'confidential_candidates', dedupeBy(vaultRows, (r) => r.id), (r) => r.id)
  if (vault.removed || vault.changed.length) {
    statements.push(['DELETE FROM confidential_candidates', []])
    if (vault.rows.length) {
      statements.push([
        `INSERT INTO confidential_candidates (id, organization_id, data, sort_order, created_at)
         SELECT id, organization_id, data, sort_order, COALESCE(created_at, NOW())
         FROM jsonb_to_recordset($1::jsonb) AS x(id text, organization_id text, data jsonb, sort_order int, created_at timestamptz)`,
        recordset(vault.rows),
      ])
    }
  }

  if (!statements.length) {
    persistedRows = next
    return
  }
  await client.query('BEGIN')
  try {
    for (const [sql, params] of statements) await client.query(sql, params)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  }
  persistedRows = next
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

/** @type {{ snapshot: DbShape, databaseUrl: string, promise: Promise<void> } | null} */
let queuedSave = null

/**
 * Saves are full-state snapshots, so callers waiting behind a running save share one
 * follow-up write with the newest snapshot instead of each queuing their own.
 */
export function saveDb(db, databaseUrl) {
  requireDatabaseUrl(databaseUrl)
  const snapshot = structuredClone(db)
  if (queuedSave) {
    queuedSave.snapshot = snapshot
    queuedSave.databaseUrl = databaseUrl
    return queuedSave.promise
  }
  const job = { snapshot, databaseUrl, promise: Promise.resolve() }
  job.promise = saveQueue.then(async () => {
    if (queuedSave === job) queuedSave = null
    await ensurePgSchema(job.databaseUrl)
    const client = await getPool(job.databaseUrl).connect()
    try { await saveRelational(client, job.snapshot) } finally { client.release() }
  })
  queuedSave = job
  saveQueue = job.promise.catch(() => {})
  return job.promise
}

export async function pingDatabase(databaseUrl) {
  try {
    requireDatabaseUrl(databaseUrl)
    await ensurePool(databaseUrl)
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

/** @param {string} databaseUrl */
export function dbPool(databaseUrl) {
  requireDatabaseUrl(databaseUrl)
  return getPool(databaseUrl)
}

export { ensurePool }

export async function closeStore() {
  await saveQueue
  if (pool) await pool.end()
  pool = null
  poolInit = null
  schemaReady = null
  persistedRows = new Map()
}
