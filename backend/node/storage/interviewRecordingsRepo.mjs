import { randomUUID } from 'node:crypto'

/**
 * @param {import('pg').Pool} pool
 * @param {{
 *   tenantId: string,
 *   interviewId: string,
 *   candidateId?: string | null,
 *   candidateEmail: string,
 *   s3ObjectKey: string,
 *   bucket?: string | null,
 *   originalFilename: string,
 *   contentType: string,
 *   fileSizeBytes?: number | null,
 *   durationSeconds?: number | null,
 *   status?: string,
 * }} row
 */
export async function insertInterviewRecording(pool, row) {
  const id = randomUUID()
  const status = row.status || 'pending'
  await pool.query(
    `INSERT INTO interview_recordings (
      id, tenant_id, interview_id, candidate_id, candidate_email,
      s3_object_key, bucket, original_filename, content_type,
      file_size_bytes, duration_seconds, status, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())`,
    [
      id,
      row.tenantId,
      row.interviewId,
      row.candidateId || null,
      row.candidateEmail.toLowerCase(),
      row.s3ObjectKey,
      row.bucket || null,
      row.originalFilename,
      row.contentType,
      row.fileSizeBytes ?? null,
      row.durationSeconds ?? null,
      status,
    ],
  )
  return id
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} id
 */
export async function getInterviewRecordingById(pool, id) {
  const res = await pool.query(
    `SELECT id, tenant_id, interview_id, candidate_id, candidate_email,
            s3_object_key, bucket, original_filename, content_type,
            file_size_bytes, duration_seconds, status, created_at, updated_at
     FROM interview_recordings WHERE id = $1`,
    [id],
  )
  return res.rows[0] || null
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} id
 * @param {{ status?: string, fileSizeBytes?: number, durationSeconds?: number }} patch
 */
export async function updateInterviewRecording(pool, id, patch) {
  const sets = []
  const vals = []
  let i = 1
  if (patch.status) {
    sets.push(`status = $${i++}`)
    vals.push(patch.status)
  }
  if (patch.fileSizeBytes != null) {
    sets.push(`file_size_bytes = $${i++}`)
    vals.push(patch.fileSizeBytes)
  }
  if (patch.durationSeconds != null) {
    sets.push(`duration_seconds = $${i++}`)
    vals.push(patch.durationSeconds)
  }
  if (!sets.length) return
  sets.push('updated_at = NOW()')
  vals.push(id)
  await pool.query(
    `UPDATE interview_recordings SET ${sets.join(', ')} WHERE id = $${i}`,
    vals,
  )
}

/**
 * @param {string} requesterEmail
 * @param {{ candidate_email: string, status?: string }} row
 */
/**
 * Latest uploaded recording for a candidate (any tenant — access checked at playback).
 * @param {import('pg').Pool} pool
 * @param {string} candidateEmail
 */
export async function getLatestInterviewRecordingForCandidate(pool, candidateEmail, activeBucket = null) {
  const email = String(candidateEmail || '').trim().toLowerCase()
  if (!email) return null
  const params = [email]
  let bucketSql = ''
  if (activeBucket) {
    params.push(activeBucket)
    bucketSql = ` AND bucket = $${params.length}`
  }
  const res = await pool.query(
    `SELECT id, tenant_id, interview_id, candidate_id, candidate_email,
            s3_object_key, bucket, original_filename, content_type,
            file_size_bytes, duration_seconds, status, created_at, updated_at
     FROM interview_recordings
     WHERE lower(candidate_email) = $1
       AND status IN ('uploaded', 'completed')${bucketSql}
     ORDER BY created_at DESC
     LIMIT 1`,
    params,
  )
  return res.rows[0] || null
}

export function canAccessInterviewRecording(requesterEmail, row) {
  if (!row) return false
  if (row.status === 'deleted') return false
  return String(requesterEmail || '').toLowerCase() === String(row.candidate_email || '').toLowerCase()
}
