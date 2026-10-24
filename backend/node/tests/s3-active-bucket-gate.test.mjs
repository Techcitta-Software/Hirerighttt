import test from 'node:test'
import assert from 'node:assert/strict'
import { neonRowUsesActiveS3Bucket, rejectUnlessActiveS3Bucket } from '../storage/s3ActiveBucketGate.mjs'

test('neonRowUsesActiveS3Bucket requires exact bucket match', () => {
  const prev = process.env.S3_BUCKET
  const prevRegion = process.env.AWS_REGION
  process.env.AWS_REGION = 'us-east-1'
  process.env.S3_BUCKET = 'new-bucket-only'
  try {
    assert.equal(neonRowUsesActiveS3Bucket({ bucket: 'new-bucket-only' }), true)
    assert.equal(neonRowUsesActiveS3Bucket({ bucket: 'old-bucket' }), false)
    assert.equal(neonRowUsesActiveS3Bucket({ bucket: null }), false)
    assert.throws(
      () => rejectUnlessActiveS3Bucket({ bucket: 'old-bucket' }),
      /current storage/,
    )
  } finally {
    process.env.S3_BUCKET = prev
    process.env.AWS_REGION = prevRegion
  }
})
