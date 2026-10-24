/**
 * Warn if legacy .env files exist (use repo-root .env only).
 * Validates S3 resume storage vars when present (see s3.md).
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv, REPO_ROOT } from '../env/loadEnv.mjs'
import { s3Env, s3StorageConfigured } from '../backend/node/storage/s3ObjectStorage.mjs'
import { verifyConfiguredS3Bucket } from '../backend/node/storage/s3StartupVerify.mjs'

const deprecated = [
  'backend/node/.env',
  'backend/.env',
  'frontend/.env',
  'backend/python/.env',
]

let found = false
for (const rel of deprecated) {
  const p = join(REPO_ROOT, rel)
  if (existsSync(p)) {
    console.warn(`[check-env] Remove deprecated ${rel} — use repo-root .env only`)
    found = true
  }
}

const rootEnv = join(REPO_ROOT, '.env')
if (!existsSync(rootEnv)) {
  console.warn('[check-env] Missing repo-root .env — copy from .env.example')
  process.exitCode = 1
} else if (!found) {
  console.log('[check-env] OK — single repo-root .env')
}

loadEnv()

if (s3StorageConfigured()) {
  const { bucket, region } = s3Env()
  const hasKey = Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
  console.log(`[check-env] S3 (single bucket): bucket=${bucket} region=${region}`)
  console.log(
    '[check-env] Object kinds: resumes, interview transcripts, reports, recordings (all under tenants/)',
  )
  if (process.env.DISABLE_SUPABASE === 'true') {
    console.log('[check-env] Supabase storage: disabled (S3-only for files)')
  }
  if (!hasKey) {
    console.warn(
      '[check-env] AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY not set — OK only if API uses an IAM role',
    )
  }
  try {
    await verifyConfiguredS3Bucket()
    console.log('[check-env] S3 HeadBucket OK — credentials target this bucket only (not Neon bucket column)')
  } catch (err) {
    console.error('[check-env]', err instanceof Error ? err.message : err)
    process.exitCode = 1
  }
  console.log('[check-env] Verify IAM upload: npm run s3:test')
} else {
  console.warn(
    '[check-env] S3 not configured — set AWS_REGION + S3_BUCKET in repo-root .env (see s3.md)',
  )
  process.exitCode = process.exitCode || 1
}
