import { randomBytes } from 'node:crypto'

/** @param {string} name */
export function slugifyOrganization(name) {
  const base = String(name || 'workspace')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return base || 'workspace'
}

/**
 * Ensure unique slug against existing organizations in cache.
 * @param {string} name
 * @param {{ slug: string }[]} organizations
 */
export function uniqueOrgSlug(name, organizations) {
  let slug = slugifyOrganization(name)
  const taken = new Set((organizations || []).map((o) => o.slug))
  if (!taken.has(slug)) return slug
  for (let i = 2; i < 100; i++) {
    const candidate = `${slug}-${i}`
    if (!taken.has(candidate)) return candidate
  }
  return `${slug}-${randomBytes(3).toString('hex')}`
}

/**
 * Create tenant + owner membership + trial subscription for a new employer user.
 * @param {import('./store.mjs').DbShape} db
 * @param {{ id: string, email: string, name: string, role?: string, companyName?: string }} user
 * @param {{ planId?: string, trialDays?: number }} [opts]
 */
export function provisionEmployerTenant(db, user, opts = {}) {
  if (user.role !== 'employer') return null

  const existingMember = (db.organizationMembers || []).find((m) => m.userId === user.id)
  if (existingMember) {
    return (db.organizations || []).find((o) => o.id === existingMember.organizationId) || null
  }

  if (!db.organizations) db.organizations = []
  if (!db.organizationMembers) db.organizationMembers = []
  if (!db.organizationSubscriptions) db.organizationSubscriptions = []

  const orgId = randomBytes(8).toString('hex')
  const orgName = user.companyName?.trim() || `${user.name.split(' ')[0]}'s Team`
  const slug = uniqueOrgSlug(orgName, db.organizations)
  const now = new Date().toISOString()
  const trialDays = opts.trialDays ?? 14
  const trialEnds = new Date(Date.now() + trialDays * 86400000).toISOString()

  const organization = {
    id: orgId,
    name: orgName,
    slug,
    billingEmail: user.email,
    status: 'active',
    settings: {},
    createdAt: now,
    updatedAt: now,
  }

  const membership = {
    id: randomBytes(8).toString('hex'),
    organizationId: orgId,
    userId: user.id,
    role: 'owner',
    joinedAt: now,
  }

  const subscription = {
    id: randomBytes(8).toString('hex'),
    organizationId: orgId,
    planId: opts.planId || 'plan-starter',
    status: 'trialing',
    trialEndsAt: trialEnds,
    createdAt: now,
    updatedAt: now,
  }

  db.organizations.push(organization)
  db.organizationMembers.push(membership)
  db.organizationSubscriptions.push(subscription)

  const account = db.users.find((u) => u.id === user.id)
  if (account) {
    account.primaryOrganizationId = orgId
    account.companyName = account.companyName || orgName
  }

  return organization
}

/**
 * Attach demo vault rows to platform org when seeding.
 * @param {unknown[]} vault
 * @param {string} [organizationId]
 */
export function tagVaultForOrganization(vault, organizationId = 'org-platform') {
  return (vault || []).map((row) => {
    if (row && typeof row === 'object' && !('organizationId' in row)) {
      return { ...row, organizationId }
    }
    return row
  })
}
