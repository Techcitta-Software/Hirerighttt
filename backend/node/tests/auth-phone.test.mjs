import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizePhone, isValidPhoneInput, findUserByPhone } from '../authPhone.mjs'

test('normalizePhone accepts 10–15 digits', () => {
  assert.equal(normalizePhone('+91 98765 43210'), '919876543210')
  assert.equal(normalizePhone('123456789'), null)
})

test('findUserByPhone detects duplicate normalized numbers', () => {
  const users = [{ email: 'a@x.com', phone: '919876543210' }]
  assert.ok(findUserByPhone(users, '+91 9876543210'))
  assert.equal(findUserByPhone(users, '+91 9999999999'), null)
})
