/**
 * Local S3 smoke test (no secrets printed). Usage from repo root:
 *   node backend/node/scripts/test-s3-resume-storage.mjs
 */
import { loadEnv } from '../loadEnv.mjs'
import { S3Client, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { s3Env, s3StorageConfigured, buildObjectKey } from '../storage/s3ObjectStorage.mjs'

loadEnv()

if (!s3StorageConfigured()) {
  console.error('[s3-test] Set AWS_REGION + S3_BUCKET in repo-root .env')
  process.exit(1)
}

const { region, bucket } = s3Env()
const client = new S3Client({ region })
const testKey = buildObjectKey('s3-test@local.dev', 'resumes', 'smoke-test.pdf')

async function main() {
  console.log('[s3-test] bucket:', bucket, 'region:', region)
  console.log('[s3-test] listing prefix resumes/ (max 10)...')
  try {
    const list = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: 'resumes/', MaxKeys: 10 }),
    )
    const keys = (list.Contents || []).map((o) => o.Key)
    console.log('[s3-test] existing resume objects:', keys.length ? keys.join('\n  ') : '(none yet)')
  } catch (err) {
    console.error('[s3-test] List failed:', err.message || err)
    console.error('  → Check IAM (s3:ListBucket on bucket) or bucket name/region')
    process.exit(1)
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
    console.log('[s3-test] IAM upload/delete works. App uploads use the same bucket under resumes/{email}/')
  } catch (err) {
    console.error('[s3-test] PutObject failed:', err.message || err)
    console.error('  → Check AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY and s3:PutObject on arn:aws:s3:::BUCKET/*')
    process.exit(1)
  }
}

main()
