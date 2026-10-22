/**
 * Local S3 smoke test (no secrets printed). Usage from repo root:
 *   node backend/node/scripts/test-s3-resume-storage.mjs
 */
import { loadEnv } from '../loadEnv.mjs'
import { S3Client, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { s3Env, s3StorageConfigured } from '../storage/s3ObjectStorage.mjs'
import { buildCandidateResumeObjectKey } from '../storage/s3KeyLayout.mjs'

loadEnv()

if (!s3StorageConfigured()) {
  console.error('[s3-test] Set AWS_REGION + S3_BUCKET in repo-root .env')
  process.exit(1)
}

const { region, bucket } = s3Env()
const client = new S3Client({ region })
const testKey = buildCandidateResumeObjectKey({
  tenantId: 'platform',
  candidateId: 's3-smoke-test',
  originalFilename: 'smoke-test.pdf',
  versionNumber: 1,
})

async function main() {
  console.log('[s3-test] bucket:', bucket, 'region:', region)
  console.log('[s3-test] listing prefix tenants/ (max 15)...')
  try {
    const list = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: 'tenants/', MaxKeys: 15 }),
    )
    const keys = (list.Contents || []).map((o) => o.Key)
    console.log('[s3-test] tenant-scoped objects:', keys.length ? keys.join('\n  ') : '(none yet)')
    const legacy = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: 'resumes/', MaxKeys: 5 }),
    )
    const legacyKeys = (legacy.Contents || []).map((o) => o.Key)
    if (legacyKeys.length) {
      console.log('[s3-test] legacy resumes/ objects (should be empty after cleanup):', legacyKeys.length ? legacyKeys.join('\n  ') : '(none)')
    }
  } catch (err) {
    console.warn('[s3-test] List skipped (optional s3:ListBucket):', err.message || err)
    console.warn('  → Upload/download still works with object-level IAM (Put/Get/Head on arn:aws:s3:::BUCKET/*)')
  }

  console.log('[s3-test] PutObject test key:', testKey)
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: testKey,
        Body: Buffer.from('%PDF-1.4 smoke'),
        ContentType: 'application/pdf',
      }),
    )
    console.log('[s3-test] PutObject OK — delete cleanup...')
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: testKey }))
    console.log(
      '[s3-test] IAM upload/delete works. New uploads use tenants/{tenant}/candidates/{id}/resumes/',
    )
  } catch (err) {
    console.error('[s3-test] PutObject failed:', err.message || err)
    console.error('  → Check AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY and s3:PutObject on arn:aws:s3:::BUCKET/*')
    process.exit(1)
  }
}

main()
