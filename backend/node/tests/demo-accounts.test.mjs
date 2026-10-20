import test from 'node:test'
import assert from 'node:assert/strict'
import { hashPassword, verifyPassword } from '../authPasswords.mjs'
import { ensureDemoUsersInDb, DEMO_SEED_USERS } from '../demoAccounts.mjs'
import { emptyDb } from '../db/store.mjs'

test('ensureDemoUsersInDb creates vendor demo with password123', async () => {
  const db = emptyDb()
  const { changed } = await ensureDemoUsersInDb(db)
  assert.equal(changed, true)
  const employer = db.users.find((u) => u.email === 'employer@hireright.com')
  assert.ok(employer)
  assert.equal(employer.role, 'employer')
  assert.equal(await verifyPassword('password123', employer.passwordHash), true)
  const member = db.organizationMembers?.find((m) => m.userId === employer.id)
  assert.ok(member)
  assert.ok(employer.primaryOrganizationId)
})

test('ensureDemoUsersInDb fixes wrong password on existing demo email', async () => {
  const db = emptyDb()
  db.users.push({
    id: 'legacy-employer-id',
    name: 'Old Recruiter',
    email: 'employer@hireright.com',
    phone: '+919999999999',
    passwordHash: await hashPassword('not-the-demo-password'),
    role: 'employer',
    status: 'active',
    createdAt: new Date().toISOString(),
  })
  const { changed } = await ensureDemoUsersInDb(db)
  assert.equal(changed, true)
  const employer = db.users.find((u) => u.email === 'employer@hireright.com')
  assert.equal(employer.id, 'legacy-employer-id')
  assert.equal(await verifyPassword('password123', employer.passwordHash), true)
})

test('DEMO_SEED_USERS includes all three login demos', () => {
  const emails = DEMO_SEED_USERS.map((d) => d.email).sort()
  assert.deepEqual(emails, [
    'admin@hireright.com',
    'demo@hireright.com',
    'employer@hireright.com',
  ])
})
