/**
 * Remove resume + interview report/transcript *indexes* from Neon (not S3 objects).
 * After this, PDF/video bytes remain in S3; the app re-creates small pointer rows on next upload.
 *
 * Usage (repo root):
 *   node backend/node/scripts/neon-purge-resume-report-index.mjs --dry-run
 *   CONFIRM_NEON_FILE_PURGE=yes node backend/node/scripts/neon-purge-resume-report-index.mjs
 */
import { loadEnv } from '../loadEnv.mjs'
import pg from 'pg'
import { loadDb, saveDb } from '../db/store.mjs'

loadEnv()

const dryRun = process.argv.includes('--dry-run')
const databaseUrl = process.env.DATABASE_URL?.trim()

if (!databaseUrl) {
  console.error('[neon-purge] DATABASE_URL is required (repo-root .env).')
  process.exit(1)
}

if (process.env.CONFIRM_NEON_FILE_PURGE !== 'yes' && !dryRun) {
  console.error(
    '[neon-purge] Set CONFIRM_NEON_FILE_PURGE=yes to clear Neon resume/report metadata (or use --dry-run).',
  )
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })

const PROFILE_STRIP_KEYS = [
  'resumeStoragePath',
  'resumeFileId',
  'resumeUrl',
  'storageProvider',
  'resumeName',
  'resumeText',
]

function stripProfileData(data) {
  if (!data || typeof data !== 'object') return data
  const next = { ...data }
  for (const key of PROFILE_STRIP_KEYS) {
    delete next[key]
  }
  return next
}

async function countTable(client, table, where = '') {
  try {
    const res = await client.query(`SELECT COUNT(*)::int AS n FROM ${table}${where}`)
    return res.rows[0]?.n ?? 0
  } catch (err) {
    if (err?.code === '42P01') return 0
    throw err
  }
}

async function main() {
  const client = await pool.connect()
  try {
    const before = {
      stored_files: await countTable(client, 'stored_files'),
      interview_artifacts: await countTable(client, 'interview_artifacts'),
      report_artifacts: await countTable(
        client,
        'interview_artifacts',
        " WHERE artifact_type = 'report'",
      ),
      transcript_artifacts: await countTable(
        client,
        'interview_artifacts',
        " WHERE artifact_type = 'transcript'",
      ),
    }

    const profileRes = await client.query(
      `SELECT COUNT(*)::int AS n FROM profiles
       WHERE data ?| ARRAY['resumeStoragePath','resumeFileId','resumeText','resumeUrl']`,
    )
    before.profiles_with_resume_fields = profileRes.rows[0]?.n ?? 0

    console.log('[neon-purge] Current Neon file metadata (bytes are NOT here — only pointers):')
    console.log('  stored_files (resume index):', before.stored_files)
    console.log('  interview_artifacts (all):', before.interview_artifacts)
    console.log('    report PDF index:', before.report_artifacts)
    console.log('    transcript JSON index:', before.transcript_artifacts)
    console.log('  profiles with resume fields in JSON:', before.profiles_with_resume_fields)
    console.log('')
    console.log('[neon-purge] S3 objects are NOT deleted. Check bucket tenants/… in AWS console.')

    if (dryRun) {
      console.log('[neon-purge] Dry run — no changes.')
      return
    }

    await client.query('BEGIN')

    await client.query(`DELETE FROM stored_files`)
    await client.query(
      `DELETE FROM interview_artifacts WHERE artifact_type IN ('report', 'transcript')`,
    )

    const profiles = await client.query(`SELECT email, data FROM profiles`)
    let profilesUpdated = 0
    for (const row of profiles.rows) {
      const stripped = stripProfileData(row.data)
      if (JSON.stringify(stripped) !== JSON.stringify(row.data)) {
        await client.query(`UPDATE profiles SET data = $1::jsonb, updated_at = NOW() WHERE email = $2`, [
          JSON.stringify(stripped),
          row.email,
        ])
        profilesUpdated += 1
      }
    }

    await client.query('COMMIT')
    console.log('[neon-purge] Deleted stored_files rows:', before.stored_files)
    console.log(
      '[neon-purge] Deleted interview_artifacts (report+transcript):',
      before.report_artifacts + before.transcript_artifacts,
    )
    console.log('[neon-purge] Cleared resume fields on profiles:', profilesUpdated)

    try {
      const db = loadDb()
      if (db.profiles) {
        for (const email of Object.keys(db.profiles)) {
          db.profiles[email] = stripProfileData(db.profiles[email])
        }
      }
      db.stored_files = []
      if (Array.isArray(db.interviewArtifacts)) {
        db.interviewArtifacts = db.interviewArtifacts.filter(
          (a) => !['report', 'transcript'].includes(String(a.artifactType || a.artifact_type || '')),
        )
      }
      await saveDb(db)
      console.log('[neon-purge] Synced in-memory/db snapshot (resume/report pointers cleared).')
    } catch (err) {
      console.warn('[neon-purge] Could not sync local db cache:', err.message || err)
    }

    console.log('')
    console.log('[neon-purge] Done. Actual files: S3 only (resumes/, videos/, reports/, transcripts/).')
    console.log('[neon-purge] Next upload/interview will add new small pointer rows in Neon again.')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('[neon-purge] failed:', err.message || err)
  process.exit(1)
})
