import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { uniqueOrgSlug } from './db/saasHelpers.mjs'

export class UniqueAccountError extends Error {
  /** @param {'email' | 'phone'} field */
  constructor(field, message) {
    super(message)
    this.name = 'UniqueAccountError'
    this.field = field
  }
}

function pgSsl(databaseUrl) {
  if (/sslmode=require|neon\.tech|amazonaws\.com/i.test(databaseUrl)) {
    return { rejectUnauthorized: false }
  }
  return undefined
}

/**
 * Create one SaaS account in Postgres (unique email + phone). Employer gets org + trial in the same transaction.
 * @param {string} databaseUrl
 * @param {{ id: string, name: string, email: string, phone: string, passwordHash: string, role: 'employer' | 'jobseeker', companyName?: string, createdAt: string }} input
 */
export async function registerAccount(databaseUrl, input) {
  const url = String(databaseUrl || '').trim()
  if (!url) throw new Error('DATABASE_URL is required for signup.')

  const client = new pg.Client({ connectionString: url, ssl: pgSsl(url) })
  await client.connect()

  try {
    await client.query('BEGIN')

    const insertUser = await client.query(
      `INSERT INTO users (id, email, name, password_hash, role, company_name, status, phone, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8::timestamptz)
       RETURNING id, email, name, password_hash, role, company_name, primary_organization_id, status, phone, created_at`,
      [
        input.id,
        input.email,
        input.name,
        input.passwordHash,
        input.role,
        input.role === 'employer' ? input.companyName || null : null,
        input.phone,
        input.createdAt,
      ],
    )

    const row = insertUser.rows[0]
    const user = {
      id: row.id,
      email: row.email,
      name: row.name,
      passwordHash: row.password_hash,
      role: row.role === 'employer' ? 'employer' : 'jobseeker',
      companyName: row.company_name || undefined,
      primaryOrganizationId: row.primary_organization_id || undefined,
      status: row.status || 'active',
      phone: row.phone || undefined,
      createdAt: row.created_at?.toISOString?.() || input.createdAt,
    }

    if (input.role !== 'employer') {
      await client.query('COMMIT')
      return { user }
    }

    const orgsRes = await client.query(`SELECT slug FROM organizations`)
    const orgId = randomBytes(8).toString('hex')
    const orgName = input.companyName?.trim() || `${input.name.split(' ')[0]}'s Team`
    const slug = uniqueOrgSlug(
      orgName,
      orgsRes.rows.map((r) => ({ slug: r.slug })),
    )
    const now = input.createdAt

    await client.query(
      `INSERT INTO organizations (id, name, slug, billing_email, status, settings, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'active','{}'::jsonb,$5::timestamptz,$5::timestamptz)`,
      [orgId, orgName, slug, input.email, now],
    )

    const memberId = randomBytes(8).toString('hex')
    await client.query(
      `INSERT INTO organization_members (id, organization_id, user_id, role, joined_at)
       VALUES ($1,$2,$3,'owner',$4::timestamptz)`,
      [memberId, orgId, user.id, now],
    )

    const trialEnds = new Date(Date.now() + 14 * 86400000).toISOString()
    const subId = randomBytes(8).toString('hex')
    await client.query(
      `INSERT INTO organization_subscriptions
         (id, organization_id, plan_id, status, trial_ends_at, created_at, updated_at)
       VALUES ($1,$2,'plan-starter','trialing',$3::timestamptz,$4::timestamptz,$4::timestamptz)`,
      [subId, orgId, trialEnds, now],
    )

    await client.query(`UPDATE users SET primary_organization_id = $1, company_name = $2 WHERE id = $3`, [
      orgId,
      orgName,
      user.id,
    ])

    user.primaryOrganizationId = orgId
    user.companyName = orgName

    await client.query('COMMIT')
    return {
      user,
      organization: { id: orgId, name: orgName, slug },
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    if (err instanceof UniqueAccountError) throw err
    if (err && typeof err === 'object' && err.code === '23505') {
      const detail = String(err.detail || err.constraint || '').toLowerCase()
      if (detail.includes('phone') || String(err.constraint || '').includes('phone')) {
        throw new UniqueAccountError('phone', 'An account with this mobile number already exists.')
      }
      throw new UniqueAccountError('email', 'An account with this email already exists.')
    }
    throw err
  } finally {
    await client.end()
  }
}
