/**
 * Remove pre-tenant legacy keys under resumes/ (s3.md §3 tenants/ layout only).
 *
 *   node backend/node/scripts/s3-cleanup-legacy.mjs           # dry-run list
 *   node backend/node/scripts/s3-cleanup-legacy.mjs --delete  # delete legacy objects
 */
import { loadEnv } from '../loadEnv.mjs'
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3'
import { s3Env, s3StorageConfigured } from '../storage/s3ObjectStorage.mjs'

loadEnv()

if (!s3StorageConfigured()) {
  console.error('[s3-cleanup] Set AWS_REGION + S3_BUCKET in repo-root .env')
  process.exit(1)
}

const deleteMode = process.argv.includes('--delete')
const { region, bucket } = s3Env()
const client = new S3Client({ region })

async function listAll(prefix) {
  const keys = []
  let token
  do {
    const out = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    )
    for (const o of out.Contents || []) {
      if (o.Key) keys.push(o.Key)
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined
  } while (token)
  return keys
}

async function main() {
  console.log('[s3-cleanup] bucket:', bucket, 'region:', region)
  const legacy = await listAll('resumes/')
  console.log('[s3-cleanup] legacy resumes/ objects:', legacy.length)
  if (legacy.length) {
    for (const k of legacy.slice(0, 20)) console.log('  ', k)
    if (legacy.length > 20) console.log(`  ... and ${legacy.length - 20} more`)
  }
  let tenants = []
  try {
    tenants = await listAll('tenants/')
    console.log('[s3-cleanup] tenants/ objects (kept):', tenants.length)
  } catch (err) {
    console.warn('[s3-cleanup] Could not list tenants/ (need s3:ListBucket):', err.message || err)
  }

  if (!legacy.length) {
    console.log('[s3-cleanup] Nothing to delete. Bucket is already tenant-organized.')
    return
  }
  if (!deleteMode) {
    console.log('[s3-cleanup] Dry run only. Re-run with --delete to remove legacy resumes/ keys.')
    console.log('[s3-cleanup] Users with old resumeStoragePath may need to re-upload resumes.')
    return
  }

  for (let i = 0; i < legacy.length; i += 1000) {
    const chunk = legacy.slice(i, i + 1000)
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
      }),
    )
  }
  console.log('[s3-cleanup] Deleted', legacy.length, 'legacy object(s).')
}

main().catch((err) => {
  console.error('[s3-cleanup] failed:', err.message || err)
  process.exit(1)
})
