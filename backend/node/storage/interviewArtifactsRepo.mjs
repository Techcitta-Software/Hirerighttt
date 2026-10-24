import { randomUUID } from 'node:crypto'

/**
 * @param {import('pg').Pool} pool
 * @param {{
 *   tenantId: string,
 *   interviewId: string,
 *   candidateEmail: string,
 *   artifactType: 'transcript' | 'report' | 'audio',
 *   s3ObjectKey: string,
 *   bucket?: string | null,
 *   contentType: string,
 *   byteSize?: number | null,
 * }} row
 */
export async function upsertInterviewArtifact(pool, row) {
  const id = randomUUID()
  await pool.query(
    `INSERT INTO interview_artifacts (
      id, tenant_id, interview_id, candidate_email, artifact_type,
      s3_object_key, bucket, content_type, byte_size, status, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ready',NOW(),NOW())
    ON CONFLICT (interview_id, artifact_type) DO UPDATE SET
      s3_object_key = EXCLUDED.s3_object_key,
      bucket = EXCLUDED.bucket,
      content_type = EXCLUDED.content_type,
      byte_size = EXCLUDED.byte_size,
      status = 'ready',
      updated_at = NOW()`,
    [
      id,
      row.tenantId,
      row.interviewId,
      row.candidateEmail.toLowerCase(),
      row.artifactType,
      row.s3ObjectKey,
      row.bucket || null,
      row.contentType,
      row.byteSize ?? null,
    ],
  )
  return id
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} interviewId
 * @param {string} artifactType
 */
export async function getInterviewArtifact(pool, interviewId, artifactType, activeBucket = null) {
  const params = [interviewId, artifactType]
  let bucketSql = ''
  if (activeBucket) {
    params.push(activeBucket)
    bucketSql = ` AND bucket = $${params.length}`
  }
  const res = await pool.query(
    `SELECT id, tenant_id, interview_id, candidate_email, artifact_type,
            s3_object_key, bucket, content_type, byte_size, status
     FROM interview_artifacts
     WHERE interview_id = $1 AND artifact_type = $2 AND status = 'ready'${bucketSql}`,
    params,
  )
  return res.rows[0] || null
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} candidateEmail
 * @param {'transcript' | 'report' | 'audio'} artifactType
 */
export async function getLatestInterviewArtifactForCandidate(
  pool,
  candidateEmail,
  artifactType,
  activeBucket = null,
) {
  const params = [String(candidateEmail || '').trim(), artifactType]
  let bucketSql = ''
  if (activeBucket) {
    params.push(activeBucket)
    bucketSql = ` AND bucket = $${params.length}`
  }
  const res = await pool.query(
    `SELECT id, tenant_id, interview_id, candidate_email, artifact_type,
            s3_object_key, bucket, content_type, byte_size, status, updated_at
     FROM interview_artifacts
     WHERE lower(candidate_email) = lower($1) AND artifact_type = $2 AND status = 'ready'${bucketSql}
     ORDER BY updated_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    params,
  )
  return res.rows[0] || null
}

/**
 * @param {string} requesterEmail
 * @param {{ candidate_email: string, status?: string }} row
 */
export function canAccessInterviewArtifact(requesterEmail, row) {
  if (!row || row.status !== 'ready') return false
  return String(requesterEmail || '').toLowerCase() === String(row.candidate_email || '').toLowerCase()
}
