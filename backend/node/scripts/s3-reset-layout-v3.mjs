/**
 * Wipe messy / legacy S3 keys and align Neon file pointers with layout v3.
 * New uploads then land under:
 *   tenants/{tenant}/resumes/{candidateId}/…
 *   tenants/{tenant}/videos/{sessionId}/…
 *   tenants/{tenant}/reports/{sessionId}/…
 *   tenants/{tenant}/transcripts/{sessionId}/…
 *
 * Usage (repo root):
 *   node backend/node/scripts/s3-reset-layout-v3.mjs --dry-run
 *   CONFIRM_S3_LAYOUT_RESET=yes node backend/node/scripts/s3-reset-layout-v3.mjs
 *
 * Optional: S3_PURGE_KEEP_DEMO_OBJECTS=1 skips keys that match demo account ids/emails.
 */
import { loadEnv } from '../loadEnv.mjs'
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3'
import pg from 'pg'
import { s3Env, s3StorageConfigured } from '../storage/s3ObjectStorage.mjs'
import { describeS3Layout } from '../storage/s3Namespace.mjs'
import { DEMO_SEED_USERS } from '../demoAccounts.mjs'

loadEnv()

const dryRun = process.argv.includes('--dry-run')
const skipNeon = process.argv.includes('--s3-only')

if (process.env.CONFIRM_S3_LAYOUT_RESET !== 'yes' && !dryRun) {
  console.error(
    '[s3-reset-v3] Set CONFIRM_S3_LAYOUT_RESET=yes to delete bucket objects and clear Neon file rows.',
  )
  console.error('[s3-reset-v3] Or use --dry-run to preview.')
  process.exit(1)
}

if (!s3StorageConfigured()) {
  console.error('[s3-reset-v3] AWS_REGION + S3_BUCKET required in repo-root .env')
  process.exit(1)
}

const { region, bucket } = s3Env()
const client = new S3Client({ region })
const layout = describeS3Layout()
const keepDemoObjects = process.env.S3_PURGE_KEEP_DEMO_OBJECTS === '1'

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

async function clearNeonFilePointers() {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) {
    console.warn('[s3-reset-v3] DATABASE_URL not set — skipping Neon pointer cleanup.')
    return
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })
  const client = await pool.connect()
  try {
    for (const table of ['interview_artifacts', 'interview_recordings', 'stored_files']) {
      try {
        const res = await client.query(`DELETE FROM ${table}`)
        console.log(`[s3-reset-v3] Neon: deleted ${res.rowCount ?? 0} row(s) from ${table}`)
      } catch (err) {
        if (err?.code === '42P01') continue
        throw err
      }
    }
    const profileRes = await client.query(`
      UPDATE profiles
      SET data = data
        - 'resumeStoragePath'
        - 'resumeFileId'
        - 'storageProvider'
      WHERE data ? 'resumeStoragePath'
         OR data ? 'resumeFileId'
    `)
    console.log(
      '[s3-reset-v3] Neon: cleared resume S3 pointers on',
      profileRes.rowCount ?? 0,
      'profile(s). Parsed resumeText kept for search.',
    )
  } finally {
    client.release()
    await pool.end()
  }
}

async function main() {
  console.log('[s3-reset-v3] target layout v', layout.version)
  console.log('[s3-reset-v3] bucket:', bucket, 'region:', region, dryRun ? '(dry-run)' : '')
  console.log('[s3-reset-v3] folders after reset:')
  console.log('  ', layout.paths.resume.replace('{tenantId}', '<tenant>').replace('{candidateId}', '<candidate>'))
  console.log('  ', layout.paths.interviewRecording.replace('{tenantId}', '<tenant>').replace('{sessionId}', '<session>'))
  console.log('  ', layout.paths.interviewReport.replace('{tenantId}', '<tenant>').replace('{sessionId}', '<session>'))
  console.log('  ', layout.paths.interviewTranscript.replace('{tenantId}', '<tenant>').replace('{sessionId}', '<session>'))

  const prefixes = ['tenants/', 'resumes/']
  let toDelete = []
  let kept = 0

  for (const prefix of prefixes) {
    let keys
    try {
      keys = await listAll(prefix)
    } catch (err) {
      console.warn(`[s3-reset-v3] Could not list ${prefix}:`, err.message || err)
      continue
    }
    console.log(`[s3-reset-v3] ${prefix} listed:`, keys.length)
    for (const key of keys) {
      if (isDemoKey(key)) {
        kept += 1
        continue
      }
      toDelete.push(key)
    }
  }

  if (keepDemoObjects && kept) {
    console.log('[s3-reset-v3] Keeping demo-related keys:', kept)
  }

  console.log('[s3-reset-v3] S3 keys to delete:', toDelete.length)
  if (toDelete.length && toDelete.length <= 40) {
    for (const k of toDelete) console.log('  ', k)
  } else if (toDelete.length) {
    for (const k of toDelete.slice(0, 12)) console.log('  ', k)
    console.log(`  ... and ${toDelete.length - 12} more`)
  }

  if (dryRun) {
    console.log('[s3-reset-v3] Dry run — no changes. Re-run with CONFIRM_S3_LAYOUT_RESET=yes to apply.')
    return
  }

  if (toDelete.length) {
    await deleteKeys(toDelete)
    console.log('[s3-reset-v3] Deleted', toDelete.length, 'S3 object(s).')
  }

  if (!skipNeon) {
    await clearNeonFilePointers()
  }

  console.log('[s3-reset-v3] Done. New uploads use layout v3 type-first folders.')
}

main().catch((err) => {
  console.error('[s3-reset-v3] failed:', err.message || err)
  process.exit(1)
})
