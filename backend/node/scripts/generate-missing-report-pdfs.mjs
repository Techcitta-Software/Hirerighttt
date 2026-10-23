/**
 * Generate HireRight scorecard PDFs with Playwright Chromium and upload to S3.
 *
 *   node backend/node/scripts/generate-missing-report-pdfs.mjs
 *   node backend/node/scripts/generate-missing-report-pdfs.mjs harshademouser1@gmail.com
 */
import { loadEnv } from '../loadEnv.mjs'
import pg from 'pg'
import { loadDb, dbPool } from '../db/store.mjs'
import { generateAndPersistInterviewReportPdf } from '../reports/generateInterviewReportPdf.mjs'
import { s3StorageConfigured } from '../storage/s3ObjectStorage.mjs'

loadEnv()

const onlyEmail = String(process.argv[2] || '').trim().toLowerCase()
const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) {
  console.error('[report-pdf] DATABASE_URL is required.')
  process.exit(1)
}
if (!s3StorageConfigured()) {
  console.error('[report-pdf] AWS_REGION + S3_BUCKET are required.')
  process.exit(1)
}

const inspectPool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
})

async function main() {
  const db = await loadDb(databaseUrl)
  const pool = dbPool(databaseUrl)

  const missing = await inspectPool.query(
    `
    SELECT ir.email,
           ir.overall,
           ir.data->>'sessionId' AS session_id
    FROM interview_results ir
    LEFT JOIN interview_artifacts ia
      ON ia.interview_id = ir.data->>'sessionId'
     AND ia.artifact_type = 'report'
    WHERE ir.data->>'sessionId' IS NOT NULL
      AND ir.data->>'sessionId' <> ''
      AND ia.id IS NULL
      AND ($1 = '' OR lower(ir.email) = $1)
    ORDER BY ir.updated_at DESC
    `,
    [onlyEmail],
  )

  if (!missing.rowCount) {
    console.log('[report-pdf] No interviews missing a report PDF.')
    await inspectPool.end()
    return
  }

  console.log(`[report-pdf] Generating ${missing.rowCount} report(s) with Chromium…`)
  for (const row of missing.rows) {
    const email = String(row.email || '').toLowerCase()
    const sessionId = String(row.session_id || '')
    const account = (db.users || []).find((u) => String(u.email || '').toLowerCase() === email)
    const result = db.interviews?.[email]
    const session = db.interviewSessions?.[sessionId]
    if (!result) {
      console.warn(`[report-pdf] skip ${email}: no interview_results payload`)
      continue
    }
    if (!session) {
      db.interviewSessions[sessionId] = { id: sessionId, email, status: 'completed' }
    } else if (!session.email) {
      session.email = email
    }

    const profile = db.profiles?.[email] || {}
    const out = await generateAndPersistInterviewReportPdf({
      pool,
      db,
      requesterEmail: email,
      account,
      sessionId,
      result,
      candidateName: account?.name,
      candidateRole: profile.currentRole || result.role,
      candidateExperience: profile.totalExperience,
      skills: Array.isArray(profile.skills) ? profile.skills : [],
    })
    console.log(`[report-pdf] uploaded ${email} session=${sessionId} key=${out.objectKey} bytes=${out.byteSize}`)
  }

  const check = await inspectPool.query(
    `
    SELECT candidate_email, interview_id, s3_object_key, byte_size
    FROM interview_artifacts
    WHERE artifact_type = 'report'
      AND ($1 = '' OR lower(candidate_email) = $1)
    ORDER BY created_at DESC
    `,
    [onlyEmail],
  )
  console.log('[report-pdf] report artifacts now:', check.rows)
  await inspectPool.end()
}

main().catch((err) => {
  console.error('[report-pdf] failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
