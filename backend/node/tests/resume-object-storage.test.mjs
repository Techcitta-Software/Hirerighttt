import test from 'node:test'
import assert from 'node:assert/strict'
import { objectStorageConfigured } from '../storage/resumeObjectStorage.mjs'
import { supabaseStorageConfigured } from '../resumeStorage.mjs'
import { s3StorageConfigured } from '../storage/s3ObjectStorage.mjs'

test('objectStorageConfigured is true when S3 or Supabase is configured', () => {
  const prevS3 = process.env.S3_BUCKET
  const prevRegion = process.env.AWS_REGION
  const prevUrl = process.env.SUPABASE_URL
  const prevKey = process.env.SUPABASE_ANON_KEY

  delete process.env.S3_BUCKET
  delete process.env.AWS_REGION
  delete process.env.SUPABASE_URL
  delete process.env.SUPABASE_ANON_KEY
  assert.equal(s3StorageConfigured(), false)
  assert.equal(supabaseStorageConfigured(), false)
  assert.equal(objectStorageConfigured(), false)

  process.env.AWS_REGION = 'us-east-1'
  process.env.S3_BUCKET = 'b'
  assert.equal(objectStorageConfigured(), true)

  process.env.S3_BUCKET = prevS3
  process.env.AWS_REGION = prevRegion
  process.env.SUPABASE_URL = prevUrl
  process.env.SUPABASE_ANON_KEY = prevKey
})
