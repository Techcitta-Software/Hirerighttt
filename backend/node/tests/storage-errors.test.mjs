import test from 'node:test'
import assert from 'node:assert/strict'
import { publicObjectStorageError } from '../storage/storageErrors.mjs'

test('publicObjectStorageError hides AWS IAM details', () => {
  const raw =
    'User: arn:aws:iam::123:user/x is not authorized to perform: s3:PutObject on resource: "arn:aws:s3:::b/resumes/a.pdf"'
  assert.equal(publicObjectStorageError(new Error(raw)), 'Secure file storage is temporarily unavailable. Please try again in a few minutes.')
})

test('publicObjectStorageError keeps short validation messages', () => {
  assert.equal(publicObjectStorageError(new Error('Resume must be between 1 byte and 2 MB.')), 'Resume must be between 1 byte and 2 MB.')
})
