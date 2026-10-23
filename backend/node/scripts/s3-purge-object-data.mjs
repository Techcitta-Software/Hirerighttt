/**
 * Delete all object data in the app S3 bucket (not the bucket itself).
 * Prefixes: tenants/, resumes/ (legacy). Optional neon/ when S3_PURGE_INCLUDE_BACKUPS=1.
 *
 *   CONFIRM_S3_PURGE=yes node backend/node/scripts/s3-purge-object-data.mjs
 *   CONFIRM_S3_PURGE=yes node backend/node/scripts/s3-purge-object-data.mjs --dry-run
 */
import { loadEnv } from '../loadEnv.mjs'
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3'
import { s3Env, s3StorageConfigured } from '../storage/s3ObjectStorage.mjs'
import { DEMO_SEED_USERS } from '../demoAccounts.mjs'

loadEnv()

const dryRun = process.argv.includes('--dry-run')
const keepDemoObjects = process.env.S3_PURGE_KEEP_DEMO_OBJECTS === '1'

if (process.env.CONFIRM_S3_PURGE !== 'yes' && !dryRun) {
  console.error(
    '[s3-purge] Set CONFIRM_S3_PURGE=yes to delete objects (or use --dry-run to list only).',
  )
  process.exit(1)
}

if (!s3StorageConfigured()) {
  console.error('[s3-purge] AWS_REGION + S3_BUCKET required in repo-root .env')
  process.exit(1)
}

const { region, bucket } = s3Env()
const client = new S3Client({ region })

const DEMO_PATH_FRAGMENTS = DEMO_SEED_USERS.flatMap((d) => [
  d.id,
  d.email.replace('@', '_at_'),
  encodeURIComponent(d.email),
])

function isDemoKey(key) {
  if (!keepDemoObjects) return false
  const k = String(key || '').toLowerCase()
  return DEMO_PATH_FRAGMENTS.some((frag) => k.includes(String(frag).toLowerCase()))
}

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

async function deleteKeys(keys) {
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000)
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
      }),
    )
  }
}

async function main() {
  const prefixes = ['tenants/', 'resumes/']
  if (process.env.S3_PURGE_INCLUDE_BACKUPS === '1') {
    const backupPrefix = (process.env.S3_BACKUP_PREFIX || 'neon/hireright/').replace(/^\//, '')
    if (backupPrefix && process.env.S3_BACKUP_BUCKET === bucket) {
      prefixes.push(backupPrefix)
    }
  }

  console.log('[s3-purge] bucket:', bucket, 'region:', region, dryRun ? '(dry-run)' : '')
  let toDelete = []
  let kept = 0

  for (const prefix of prefixes) {
    let keys
    try {
      keys = await listAll(prefix)
    } catch (err) {
      console.warn(`[s3-purge] Could not list ${prefix}:`, err.message || err)
      continue
    }
    console.log(`[s3-purge] ${prefix} objects listed:`, keys.length)
    for (const key of keys) {
      if (isDemoKey(key)) {
        kept += 1
        continue
      }
      toDelete.push(key)
    }
  }

  if (keepDemoObjects && kept) {
    console.log('[s3-purge] Keeping demo-related keys:', kept)
  }

  console.log('[s3-purge] Keys to delete:', toDelete.length)
  if (toDelete.length && toDelete.length <= 30) {
    for (const k of toDelete) console.log('  ', k)
  } else if (toDelete.length) {
    for (const k of toDelete.slice(0, 15)) console.log('  ', k)
    console.log(`  ... and ${toDelete.length - 15} more`)
  }

  if (dryRun || !toDelete.length) return

  await deleteKeys(toDelete)
  console.log('[s3-purge] Deleted', toDelete.length, 'object(s). Bucket and prefix layout unchanged.')
}

main().catch((err) => {
  console.error('[s3-purge] failed:', err.message || err)
  process.exit(1)
})
