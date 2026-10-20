import { hashPassword, verifyPassword } from './authPasswords.mjs'
import { provisionEmployerTenant } from './db/saasHelpers.mjs'

/** Must match frontend/src/lib/authDemo.ts */
export const DEMO_SEED_USERS = [
  {
    id: 'demo-user-candidate',
    name: 'Arjun Sharma',
    email: 'demo@hireright.com',
    password: 'password123',
    phone: '+919000000001',
    role: 'jobseeker',
  },
  {
    id: 'demo-user-employer',
    name: 'Sarah Jenkins (Recruiter)',
    email: 'employer@hireright.com',
    password: 'password123',
    phone: '+919000000002',
    role: 'employer',
    companyName: 'TechCitta Solutions',
  },
  {
    id: 'demo-user-admin',
    name: 'Alex Morgan (Admin)',
    email: 'admin@hireright.com',
    password: 'password123',
    phone: '+919000000003',
    role: 'employer',
    companyName: 'HIRERIGHT Recruiting',
  },
]

const DEMO_EMAILS = new Set(DEMO_SEED_USERS.map((d) => d.email))

export function isDemoSeedEmail(email) {
  return DEMO_EMAILS.has(String(email || '').trim().toLowerCase())
}

/**
 * Ensure demo logins exist in Postgres-backed cache with password123 and employer tenants.
 * Re-syncs password/role when ALLOW_DEMO_ACCOUNTS is on (safe for imported Neon DBs).
 * @param {import('./db/store.mjs').DbShape} db
 */
export async function ensureDemoUsersInDb(db) {
  if (!db.users) db.users = []
  let changed = false
  const now = new Date().toISOString()

  for (const demo of DEMO_SEED_USERS) {
    let account = db.users.find((u) => u.email === demo.email)
    if (!account) {
      account = {
        id: demo.id,
        name: demo.name,
        email: demo.email,
        phone: demo.phone,
        passwordHash: await hashPassword(demo.password),
        role: demo.role,
        companyName: demo.companyName,
        status: 'active',
        createdAt: now,
      }
      db.users.push(account)
      changed = true
    } else {
      const passwordOk = await verifyPassword(demo.password, account.passwordHash)
      if (!passwordOk) {
        account.passwordHash = await hashPassword(demo.password)
        changed = true
      }
      if (account.status !== 'active') {
        account.status = 'active'
        changed = true
      }
      if (account.role !== demo.role) {
        account.role = demo.role
        changed = true
      }
      if (demo.companyName && account.companyName !== demo.companyName) {
        account.companyName = demo.companyName
        changed = true
      }
      if (!account.phone) {
        account.phone = demo.phone
        changed = true
      }
      if (!account.name?.trim()) {
        account.name = demo.name
        changed = true
      }
    }
  }

  for (const demo of DEMO_SEED_USERS) {
    if (demo.role !== 'employer') continue
    const account = db.users.find((u) => u.email === demo.email)
    if (!account) continue
    const beforeOrgs = db.organizations?.length || 0
    provisionEmployerTenant(db, account, { planId: 'plan-pro' })
    if ((db.organizations?.length || 0) > beforeOrgs) changed = true
    const member = (db.organizationMembers || []).find((m) => m.userId === account.id)
    if (member && !account.primaryOrganizationId) {
      account.primaryOrganizationId = member.organizationId
      changed = true
    }
  }

  return { db, changed }
}
