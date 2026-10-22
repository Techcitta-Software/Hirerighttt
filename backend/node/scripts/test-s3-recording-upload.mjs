/**
 * Smoke test: interview-style video upload (presigned PUT), same as the browser path.
 * Usage: node backend/node/scripts/test-s3-recording-upload.mjs
 */
import { loadEnv } from '../loadEnv.mjs'
import { buildInterviewRecordingObjectKey } from '../storage/s3KeyLayout.mjs'
import {
  defaultS3ObjectStorage,
  s3Env,
  s3StorageConfigured,
} from '../storage/s3ObjectStorage.mjs'

loadEnv()

if (!s3StorageConfigured()) {
  console.error('[s3-recording-test] Set AWS_REGION + S3_BUCKET in repo-root .env')
  process.exit(1)
}

const { region, bucket } = s3Env()
const fakeSessionId = `smoke-recording-${Date.now()}`
const objectKey = buildInterviewRecordingObjectKey({
  tenantId: 'platform',
  interviewId: fakeSessionId,
  originalFilename: 'smoke_interview.webm',
  contentType: 'video/webm',
})

/** Minimal blob (>256 B) — not a playable WebM; enough for PutObject / HeadObject. */
const body = Buffer.alloc(512, 0x00)
body.write('webm-smoke-test', 0)

async function main() {
  console.log('[s3-recording-test] bucket:', bucket, 'region:', region)
  console.log('[s3-recording-test] key:', objectKey)

  let presigned
  try {
    presigned = await defaultS3ObjectStorage.presignUpload({
      key: objectKey,
      contentType: 'video/webm',
      contentLength: body.length,
    })
    console.log('[s3-recording-test] presigned PUT URL OK (expires', presigned.expiresInSeconds, 's)')
  } catch (err) {
    console.error('[s3-recording-test] presign failed:', err.message || err)
    console.error('  → IAM needs s3:PutObject on arn:aws:s3:::' + bucket + '/*')
    process.exit(1)
  }

  let putRes
  try {
    putRes = await fetch(presigned.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/webm' },
      body,
    })
  } catch (err) {
    console.error('[s3-recording-test] PUT to S3 failed (network/CORS):', err.message || err)
    process.exit(1)
  }

  if (!putRes.ok) {
    const text = await putRes.text().catch(() => '')
    console.error('[s3-recording-test] PUT HTTP', putRes.status, text.slice(0, 500))
    if (putRes.status === 403) {
      console.error('  → Presigned URL rejected: check clock skew, bucket policy, or KMS settings.')
    }
    process.exit(1)
  }
  console.log('[s3-recording-test] PUT HTTP', putRes.status, 'OK')

  try {
    const head = await defaultS3ObjectStorage.headObject({ key: objectKey })
    if (!head) {
      console.error('[s3-recording-test] HeadObject: object not found after PUT')
      process.exit(1)
    }
    console.log('[s3-recording-test] HeadObject OK — size', head.ContentLength, 'bytes')
  } catch (err) {
    console.error('[s3-recording-test] HeadObject failed:', err.message || err)
    console.error('  → IAM needs s3:GetObject / s3:HeadObject on arn:aws:s3:::' + bucket + '/*')
    process.exit(1)
  }

  console.log('')
  console.log('[s3-recording-test] SUCCESS — object left in bucket for console verification:')
  console.log('  s3://' + bucket + '/' + objectKey)
}

main().catch((err) => {
  console.error('[s3-recording-test] failed:', err.message || err)
  process.exit(1)
})
