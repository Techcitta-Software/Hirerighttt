/**
 * Applies the bucket CORS rule the browser needs for presigned recording PUTs.
 * Without it the browser blocks the PUT ("Failed to fetch") even though server-side uploads work.
 * Origins come from CORS_ORIGINS (+ S3_CORS_EXTRA_ORIGINS). Requires s3:PutBucketCORS on the IAM user.
 * Usage: npm run s3:cors
 */
import { S3Client, PutBucketCorsCommand } from '@aws-sdk/client-s3'
import { loadEnv } from '../loadEnv.mjs'
import { s3Env, s3StorageConfigured } from '../storage/s3ObjectStorage.mjs'

loadEnv()

if (!s3StorageConfigured()) {
  console.error('[s3-cors] Set AWS_REGION + S3_BUCKET in repo-root .env')
  process.exit(1)
}

const { region, bucket } = s3Env()
const origins = [
  ...String(process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(','),
  ...String(process.env.S3_CORS_EXTRA_ORIGINS || '').split(','),
]
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter((o) => o && o !== '*')
const uniqueOrigins = [...new Set(origins)]

const corsRule = {
  AllowedOrigins: uniqueOrigins,
  AllowedMethods: ['PUT', 'GET', 'HEAD'],
  AllowedHeaders: ['*'],
  ExposeHeaders: ['ETag'],
  MaxAgeSeconds: 3000,
}

try {
  await new S3Client({ region }).send(
    new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: [corsRule] } }),
  )
  console.log(`[s3-cors] Applied CORS to s3://${bucket} for:`, uniqueOrigins.join(', '))
} catch (err) {
  console.error(`[s3-cors] Could not set CORS on s3://${bucket}: ${err?.name || ''} ${err?.message || err}`)
  console.error('[s3-cors] Paste this into S3 → bucket → Permissions → CORS instead:')
  console.error(JSON.stringify([corsRule], null, 2))
  process.exit(1)
}
