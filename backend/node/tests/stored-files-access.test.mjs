import test from 'node:test'
import assert from 'node:assert/strict'
import { canAccessStoredFile } from '../storage/storedFilesRepo.mjs'

test('canAccessStoredFile allows owner only', () => {
  const row = { owner_email: 'a@test.com', status: 'ready', deleted_at: null }
  assert.equal(canAccessStoredFile('a@test.com', row), true)
  assert.equal(canAccessStoredFile('b@test.com', row), false)
  assert.equal(canAccessStoredFile('A@test.com', row), true)
})

test('canAccessStoredFile denies deleted or non-ready rows', () => {
  assert.equal(canAccessStoredFile('a@test.com', { owner_email: 'a@test.com', deleted_at: new Date() }), false)
  assert.equal(canAccessStoredFile('a@test.com', { owner_email: 'a@test.com', status: 'pending' }), false)
})
