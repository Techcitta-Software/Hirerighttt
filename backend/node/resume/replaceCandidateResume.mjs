import { upsertCandidateTalent } from '../db/talentIndex.mjs'
import { dbPool } from '../db/store.mjs'
import { parseResumeWithAI } from '../interviewAgent.mjs'
import { parseResumeUploadBody } from '../storage/resumeUploadValidation.mjs'
import {
  objectStorageConfigured,
  uploadResumeToObjectStorage,
} from '../storage/resumeObjectStorage.mjs'
import { getStoredFileById } from '../storage/storedFilesRepo.mjs'
import { defaultS3ObjectStorage, s3Env, s3StorageConfigured } from '../storage/s3ObjectStorage.mjs'
import { publicObjectStorageError } from '../storage/storageErrors.mjs'

/** Profile fields overwritten from a new resume parse (manual edits like links are kept). */
export const RESUME_SOURCED_PROFILE_KEYS = [
  'resumeText',
  'skills',
  'workExperiences',
  'experienceSummary',
  'achievements',
  'certifications',
  'metrics',
  'whoAreYou',
  'whatDrivesYou',
  'keyStrengths',
  'awards',
  'noPriorWorkExperience',
  'fullName',
  'name',
  'currentRole',
  'totalExperience',
  'currentLocation',
  'preferredRoles',
  'preferredLocations',
  'noticePeriod',
  'salaryExpectation',
  'workMode',
]

/**
 * @param {Record<string, unknown>} prev
 * @param {{ extract?: Record<string, unknown>, upload: Record<string, unknown>, filename: string }} input
 */
export function buildResumeReplacementProfile(prev, { extract = {}, upload, filename }) {
  const base = { ...(prev || {}) }
  for (const key of RESUME_SOURCED_PROFILE_KEYS) {
    delete base[key]
  }
  const patch = { ...(extract || {}) }
  if (patch.fullName && !patch.name) patch.name = patch.fullName
  return {
    ...base,
    ...patch,
    resumeName: filename,
    ...upload,
    updatedAt: new Date().toISOString(),
  }
}

async function deleteS3ObjectSafe(s3, key) {
  const k = String(key || '').trim()
  if (!k || !s3) return
  try {
    await s3.deleteObject({ key: k })
  } catch (err) {
    console.warn('[resume-replace] S3 delete failed:', k, err instanceof Error ? err.message : err)
  }
}

/**
 * @param {{
 *   pool: import('pg').Pool | null,
 *   s3: ReturnType<typeof import('../storage/s3ObjectStorage.mjs').createS3ObjectStorage>,
 *   email: string,
 *   prevProfile: Record<string, unknown>,
 *   db: import('../db/store.mjs').DbShape,
 * }} opts
 */
export async function purgePriorResumeAndInterviewArtifacts(opts) {
  const email = String(opts.email || '').toLowerCase()
  const bucket = s3StorageConfigured() ? s3Env()?.bucket : null
  const s3 = opts.s3
  let recordings = 0
  let artifacts = 0

  const prev = opts.prevProfile || {}
  if (s3StorageConfigured() && s3 && bucket) {
    if (prev.resumeStoragePath) {
      await deleteS3ObjectSafe(s3, String(prev.resumeStoragePath))
    }
    if (prev.resumeFileId && opts.pool) {
      const row = await getStoredFileById(opts.pool, String(prev.resumeFileId))
      if (row?.object_key) {
        await deleteS3ObjectSafe(s3, row.object_key)
      }
      await opts.pool.query(
        `UPDATE stored_files SET deleted_at = NOW(), status = 'deleted' WHERE id = $1`,
        [prev.resumeFileId],
      )
    }
  }

  if (opts.pool) {
    const recRes = await opts.pool.query(
      `SELECT id, s3_object_key, bucket FROM interview_recordings
       WHERE lower(candidate_email) = lower($1)
         AND status IN ('uploaded', 'completed', 'ready')`,
      [email],
    )
    for (const row of recRes.rows) {
      recordings += 1
      if (s3 && bucket) {
        await deleteS3ObjectSafe(s3, row.s3_object_key)
      }
    }
    await opts.pool.query(
      `UPDATE interview_recordings SET status = 'deleted', updated_at = NOW()
       WHERE lower(candidate_email) = lower($1)`,
      [email],
    )

    const artRes = await opts.pool.query(
      `SELECT id, s3_object_key, bucket FROM interview_artifacts
       WHERE lower(candidate_email) = lower($1) AND status = 'ready'`,
      [email],
    )
    for (const row of artRes.rows) {
      artifacts += 1
      if (s3 && bucket) {
        await deleteS3ObjectSafe(s3, row.s3_object_key)
      }
    }
    await opts.pool.query(
      `UPDATE interview_artifacts SET status = 'deleted', updated_at = NOW()
       WHERE lower(candidate_email) = lower($1)`,
      [email],
    )

    await opts.pool.query(`DELETE FROM interview_results WHERE lower(email) = lower($1)`, [email])
  }

  if (!opts.db.interviews) opts.db.interviews = {}
  if (!opts.db.interviewSessions) opts.db.interviewSessions = {}
  delete opts.db.interviews[email]
  for (const sid of Object.keys(opts.db.interviewSessions)) {
    const session = /** @type {{ email?: string }} */ (opts.db.interviewSessions[sid])
    if (String(session?.email || '').toLowerCase() === email) {
      delete opts.db.interviewSessions[sid]
    }
  }

  return { recordings, artifacts }
}

/**
 * @param {{
 *   config: { databaseUrl?: string },
 *   email: string,
 *   body: Record<string, unknown>,
 *   db: import('../db/store.mjs').DbShape,
 *   saveDb: (db: import('../db/store.mjs').DbShape) => Promise<void>,
 * }} opts
 */
export async function replaceCandidateResume({ config, email, body, db, saveDb }) {
  if (!objectStorageConfigured()) {
    const err = new Error('Resume object storage is not configured (S3 or Supabase).')
    err.status = 503
    err.skipped = true
    throw err
  }

  const parsed = parseResumeUploadBody(body)
  if (!db?.profiles) {
    const err = new Error('Server database is not ready. Refresh and try again.')
    err.status = 503
    throw err
  }
  const account = (db.users || []).find((u) => u.email === email)
  const prev = /** @type {Record<string, unknown>} */ (db.profiles[email] || {})
  const pool = config.databaseUrl ? dbPool(config.databaseUrl) : null
  const s3 = s3StorageConfigured() ? defaultS3ObjectStorage : null

  const purged = await purgePriorResumeAndInterviewArtifacts({
    pool,
    s3,
    email,
    prevProfile: prev,
    db,
  })

  const uploaded = await uploadResumeToObjectStorage({
    pool,
    candidateEmail: email,
    ownerUserId: account?.id,
    primaryOrganizationId: account?.primaryOrganizationId,
    filename: parsed.filename,
    buffer: parsed.buffer,
    contentType: parsed.contentType,
  })

  let extract = body.extract && typeof body.extract === 'object' ? body.extract : null
  const resumeText = String(body.resumeText || extract?.resumeText || '').trim()
  if (!extract && resumeText.length >= 40) {
    extract = await parseResumeWithAI(resumeText)
  }
  if (!extract) {
    extract = resumeText ? { resumeText: resumeText.slice(0, 12000) } : {}
  } else if (resumeText && !extract.resumeText) {
    extract.resumeText = resumeText.slice(0, 12000)
  }

  const profilePatch = buildResumeReplacementProfile(prev, {
    extract,
    upload: {
      resumeStoragePath: uploaded.storagePath,
      resumeUrl: uploaded.resumeUrl,
      resumeFileId: uploaded.fileId,
      storageProvider: uploaded.storageProvider,
    },
    filename: parsed.filename,
  })

  db.profiles[email] = profilePatch
  await saveDb(db)

  if (pool) {
    await pool.query(
      `INSERT INTO profiles (email, data, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (email) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [email, JSON.stringify(profilePatch)],
    )
  }

  if (account && config.databaseUrl) {
    try {
      await upsertCandidateTalent(config.databaseUrl, account, profilePatch, null)
    } catch (err) {
      console.warn('[resume-replace] talent index:', err instanceof Error ? err.message : err)
    }
  }

  console.log(
    `[resume-replace] email=${email} key=${uploaded.storagePath} purged_recordings=${purged.recordings} purged_artifacts=${purged.artifacts}`,
  )

  return { profile: profilePatch, purged, storagePath: uploaded.storagePath }
}

export function publicReplaceResumeError(err) {
  if (err?.skipped) return { status: err.status || 503, body: { error: err.message, skipped: true } }
  const status = err?.status || 502
  return {
    status,
    body: {
      error: publicObjectStorageError(err, 'Could not replace resume. Please try again.'),
    },
  }
}
