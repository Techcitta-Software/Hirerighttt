/**
 * Diagnose interview video + report for a candidate (Neon + S3 pointers).
 *   node backend/node/scripts/inspect-interview-storage.mjs [email]
 */
import { loadEnv } from '../loadEnv.mjs'
import pg from 'pg'
import { S3Client, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3'
import { s3Env, s3StorageConfigured } from '../storage/s3ObjectStorage.mjs'

loadEnv()

const email = String(process.argv[2] || 'harshademouser1@gmail.com').trim().toLowerCase()
const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) {
  console.error('DATABASE_URL missing')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })

async function q(label, sql, params = []) {
  try {
    const res = await pool.query(sql, params)
    console.log(`\n=== ${label} (${res.rowCount} rows) ===`)
    if (!res.rowCount) {
      console.log('(empty)')
      return []
    }
    console.log(JSON.stringify(res.rows, null, 2))
    return res.rows
  } catch (err) {
    console.log(`\n=== ${label} ERROR ===`)
    console.log(err.message)
    return []
  }
}

async function main() {
  console.log('[inspect] candidate:', email)

  await q(
    'users',
    `SELECT id, email, name, role, created_at FROM users WHERE lower(email) = $1`,
    [email],
  )
  await q(
    'profiles resume pointers',
    `SELECT email, updated_at,
            data->>'resumeName' AS resume_name,
            left(coalesce(data->>'resumeText',''), 40) AS resume_text_prefix,
            data->>'resumeStoragePath' AS resume_storage_path,
            data->>'resumeS3Key' AS resume_s3_key,
            data->'resumeStorage' AS resume_storage
     FROM profiles WHERE lower(email) = $1`,
    [email],
  )
  const interviews = await q(
    'interview_results',
    `SELECT email, overall, updated_at,
            data->>'sessionId' AS session_id,
            data->>'date' AS interview_date,
            data ? 'scorecard' AS has_scorecard
     FROM interview_results WHERE lower(email) = $1`,
    [email],
  )
  await q(
    'interview_sessions',
    `SELECT session_id, email, organization_id, updated_at
     FROM interview_sessions WHERE lower(email) = $1
     ORDER BY updated_at DESC NULLS LAST`,
    [email],
  )
  await q(
    'interview_recordings',
    `SELECT id, tenant_id, interview_id, candidate_email, s3_object_key, bucket,
            status, file_size_bytes, duration_seconds, created_at
     FROM interview_recordings
     WHERE lower(candidate_email) = $1
     ORDER BY created_at DESC`,
    [email],
  )
  await q(
    'interview_artifacts',
    `SELECT id, tenant_id, interview_id, candidate_email, artifact_type,
            s3_object_key, bucket, byte_size, created_at
     FROM interview_artifacts
     WHERE lower(candidate_email) = $1
     ORDER BY created_at DESC`,
    [email],
  )
  await q(
    'stored_files',
    `SELECT id, owner_email, purpose, object_key, bucket, created_at
     FROM stored_files WHERE lower(owner_email) = $1
     ORDER BY created_at DESC`,
    [email],
  )
  await q(
    'employer_applications',
    `SELECT id, job_id, candidate_email, status, applied_at,
            data->>'resumeName' AS resume_name,
            data ? 'interviewResult' AS has_interview_result
     FROM employer_applications WHERE lower(candidate_email) = $1`,
    [email],
  )

  await q(
    'all interview_recordings (any user)',
    `SELECT candidate_email, interview_id, s3_object_key, status, created_at
     FROM interview_recordings ORDER BY created_at DESC LIMIT 20`,
  )
  await q(
    'all interview_artifacts (any user)',
    `SELECT candidate_email, interview_id, artifact_type, s3_object_key, created_at
     FROM interview_artifacts ORDER BY created_at DESC LIMIT 20`,
  )
  await q(
    'all interview_results emails',
    `SELECT email, overall, data->>'sessionId' AS session_id, updated_at
     FROM interview_results ORDER BY updated_at DESC LIMIT 20`,
  )

  if (s3StorageConfigured()) {
    const { region, bucket } = s3Env()
    const client = new S3Client({ region })
    console.log(`\n=== S3 list tenants/ bucket=${bucket} region=${region} ===`)
    const keys = []
    let token
    try {
      do {
        const out = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: 'tenants/',
            ContinuationToken: token,
          }),
        )
        for (const o of out.Contents || []) {
          if (o.Key) keys.push({ key: o.Key, size: o.Size, modified: o.LastModified })
        }
        token = out.IsTruncated ? out.NextContinuationToken : undefined
      } while (token)
      console.log(`listed ${keys.length} object(s)`)
      for (const k of keys) console.log(k)
    } catch (err) {
      console.log('S3 list failed:', err.message)
    }

    const pointed = []
    const recs = await pool.query(
      `SELECT s3_object_key FROM interview_recordings WHERE lower(candidate_email)=$1`,
      [email],
    )
    const arts = await pool.query(
      `SELECT s3_object_key FROM interview_artifacts WHERE lower(candidate_email)=$1`,
      [email],
    )
    for (const row of [...recs.rows, ...arts.rows]) {
      if (row.s3_object_key) pointed.push(row.s3_object_key)
    }
    if (pointed.length) {
      console.log('\n=== S3 HeadObject for DB keys ===')
      for (const key of pointed) {
        try {
          const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
          console.log('EXISTS', key, head.ContentLength, head.ContentType)
        } catch (err) {
          console.log('MISSING', key, err.name, err.message)
        }
      }
    }
  } else {
    console.log('\nS3 not configured')
  }

  const sessionId = interviews[0]?.session_id
  if (sessionId) console.log('\n[inspect] latest sessionId from interview_results:', sessionId)

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
