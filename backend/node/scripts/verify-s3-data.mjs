/**
 * Verify objects exist in configured S3 bucket + optional Neon pointer rows.
 *   node backend/node/scripts/verify-s3-data.mjs
 */
import { loadEnv } from '../loadEnv.mjs'
import pg from 'pg'
import { S3Client, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3'
import { s3Env, s3StorageConfigured } from '../storage/s3ObjectStorage.mjs'
import { activeS3BucketName } from '../storage/s3ActiveBucketGate.mjs'

loadEnv()

if (!s3StorageConfigured()) {
  console.error('[verify-s3] Set AWS_REGION + S3_BUCKET in repo-root .env')
  process.exit(1)
}

const { region, bucket } = s3Env()
const active = activeS3BucketName()
const client = new S3Client({ region })

async function headKey(key) {
  try {
    const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return { ok: true, size: out.ContentLength, type: out.ContentType }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function listTenants(maxKeys = 50) {
  try {
    const out = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: 'tenants/', MaxKeys: maxKeys }),
    )
    return (out.Contents || []).map((o) => ({
      key: o.Key,
      size: o.Size,
      modified: o.LastModified?.toISOString?.() || '',
    }))
  } catch (err) {
    return { listError: err instanceof Error ? err.message : String(err) }
  }
}

async function neonPointers(databaseUrl) {
  const pool = new pg.Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })
  const out = { stored_files: [], interview_artifacts: [], interview_recordings: [] }
  try {
    const sf = await pool.query(
      `SELECT owner_email, object_key, bucket, byte_size, created_at
       FROM stored_files
       WHERE deleted_at IS NULL AND storage_provider = 's3'
         AND bucket = $1
       ORDER BY created_at DESC LIMIT 10`,
      [active],
    )
    out.stored_files = sf.rows

    const ia = await pool.query(
      `SELECT candidate_email, interview_id, artifact_type, s3_object_key, bucket, byte_size, updated_at
       FROM interview_artifacts
       WHERE bucket = $1 AND status = 'ready'
       ORDER BY updated_at DESC LIMIT 10`,
      [active],
    )
    out.interview_artifacts = ia.rows

    const ir = await pool.query(
      `SELECT candidate_email, interview_id, s3_object_key, bucket, status, file_size_bytes, created_at
       FROM interview_recordings
       WHERE bucket = $1 AND status IN ('uploaded', 'completed')
       ORDER BY created_at DESC LIMIT 10`,
      [active],
    )
    out.interview_recordings = ir.rows
  } catch (err) {
    out.dbError = err instanceof Error ? err.message : String(err)
  } finally {
    await pool.end()
  }
  return out
}

async function main() {
  console.log('[verify-s3] bucket:', bucket)
  console.log('[verify-s3] region:', region)
  console.log('[verify-s3] active bucket filter (Neon):', active)
  console.log('')

  const listed = await listTenants()
  if (listed.listError) {
    console.log('[verify-s3] ListObjects tenants/ — skipped:', listed.listError)
    console.log('  (Add s3:ListBucket on the bucket to list in console/scripts; HeadObject still works per key.)\n')
  } else {
    console.log(`[verify-s3] ListObjects tenants/ — ${listed.length} object(s) (max 50 shown):`)
    if (!listed.length) {
      console.log('  (none — run npm run s3:smoke-samples or upload a resume / complete an interview)\n')
    } else {
      for (const o of listed) {
        console.log(`  ${o.size} bytes  ${o.modified}  ${o.key}`)
      }
      console.log('')
    }
  }

  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) {
    console.log('[verify-s3] DATABASE_URL not set — skipping Neon pointer check\n')
  } else {
    console.log('[verify-s3] Neon rows pointing at this bucket (latest 10 each):')
    const neon = await neonPointers(databaseUrl)
    if (neon.dbError) {
      console.log('  DB error:', neon.dbError, '\n')
    } else {
      console.log('  stored_files:', neon.stored_files.length)
      console.log('  interview_artifacts:', neon.interview_artifacts.length)
      console.log('  interview_recordings:', neon.interview_recordings.length)
      console.log('')

      const keysToVerify = []
      for (const r of neon.stored_files) keysToVerify.push({ source: 'stored_files', key: r.object_key, label: r.owner_email })
      for (const r of neon.interview_artifacts) {
        keysToVerify.push({
          source: `interview_artifacts/${r.artifact_type}`,
          key: r.s3_object_key,
          label: r.candidate_email,
        })
      }
      for (const r of neon.interview_recordings) {
        keysToVerify.push({ source: 'interview_recordings', key: r.s3_object_key, label: r.candidate_email })
      }

      if (!keysToVerify.length) {
        console.log('[verify-s3] No Neon pointers for this bucket yet — app uploads will create them.\n')
      } else {
        console.log('[verify-s3] HeadObject check for Neon pointers:')
        let ok = 0
        let missing = 0
        for (const item of keysToVerify) {
          const h = await headKey(item.key)
          if (h.ok) {
            ok++
            console.log(`  OK   ${h.size}B  ${item.source}  ${item.label}`)
            console.log(`       s3://${bucket}/${item.key}`)
          } else {
            missing++
            console.log(`  MISS ${item.source}  ${item.label}`)
            console.log(`       ${item.key}`)
            console.log(`       ${h.error}`)
          }
        }
        console.log('')
        console.log(`[verify-s3] Neon pointers: ${ok} found in S3, ${missing} missing`)
      }
    }
  }

  const smokePrefix = 'tenants/platform/candidates/smoke-verification/'
  const smokeKeys = [
    `${smokePrefix}interviews/smoke-session-demo/transcripts/transcript.json`,
    `${smokePrefix}interviews/smoke-session-demo/reports/interview_report.pdf`,
  ]
  console.log('[verify-s3] Spot-check smoke sample keys (if you ran s3:smoke-samples):')
  for (const key of smokeKeys) {
    const h = await headKey(key)
    console.log(h.ok ? `  OK   s3://${bucket}/${key} (${h.size} bytes)` : `  —    ${key} (${h.error})`)
  }
  console.log('')
  console.log('[verify-s3] Done. In AWS Console: S3 →', bucket, '→ prefix tenants/')
}

main().catch((err) => {
  console.error('[verify-s3] failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
