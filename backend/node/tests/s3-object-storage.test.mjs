import test from 'node:test'
import assert from 'node:assert/strict'
import { buildObjectKey, createS3ObjectStorage, s3StorageConfigured } from '../storage/s3ObjectStorage.mjs'

test('s3StorageConfigured requires region and bucket', () => {
  const prevRegion = process.env.AWS_REGION
  const prevBucket = process.env.S3_BUCKET
  process.env.AWS_REGION = 'us-east-1'
  process.env.S3_BUCKET = 'test-bucket'
  assert.equal(s3StorageConfigured(), true)
  delete process.env.S3_BUCKET
  assert.equal(s3StorageConfigured(), false)
  process.env.AWS_REGION = prevRegion
  process.env.S3_BUCKET = prevBucket
})

test('buildObjectKey scopes by purpose and owner email', () => {
  const key = buildObjectKey('User@Example.com', 'resumes', 'My Resume.PDF')
  assert.match(key, /^resumes\/user_example\.com\/[0-9a-f-]{36}\.pdf$/i)
})

test('uploadObject and presignDownload use injected client', async () => {
  const prevRegion = process.env.AWS_REGION
  const prevBucket = process.env.S3_BUCKET
  process.env.AWS_REGION = 'us-east-1'
  process.env.S3_BUCKET = 'unit-test-bucket'

  const calls = []
  const storage = createS3ObjectStorage({
    getClient: () => ({
      send: async (command) => {
        calls.push(command.constructor.name)
        if (command.constructor.name === 'HeadObjectCommand') {
          return { ContentLength: 10 }
        }
        return {}
      },
    }),
  })

  const tenantKey = 'tenants/platform/resumes/user-1/resume_v1_test.pdf'
  await storage.uploadObject({
    key: tenantKey,
    buffer: Buffer.from('pdf'),
    contentType: 'application/pdf',
  })
  assert.ok(calls.includes('PutObjectCommand'))

  const head = await storage.headObject({ key: tenantKey })
  assert.equal(head.ContentLength, 10)

  process.env.AWS_REGION = prevRegion
  process.env.S3_BUCKET = prevBucket
})
