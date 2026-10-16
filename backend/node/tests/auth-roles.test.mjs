import test from 'node:test'
import assert from 'node:assert/strict'
import { validateEmployerSignup, loginRoleMismatchMessage } from '../authRoles.mjs'

test('validateEmployerSignup requires company for vendors', () => {
  assert.equal(validateEmployerSignup('jobseeker', ''), null)
  assert.ok(validateEmployerSignup('employer', ''))
  assert.equal(validateEmployerSignup('employer', 'Acme Corp'), null)
})

test('loginRoleMismatchMessage separates vendor and candidate', () => {
  assert.equal(loginRoleMismatchMessage('employer', 'employer'), null)
  assert.ok(loginRoleMismatchMessage('employer', 'jobseeker')?.includes('candidate'))
  assert.ok(loginRoleMismatchMessage('jobseeker', 'employer')?.includes('employer'))
})
