import { randomUUID } from 'node:crypto'

/**
 * @param {import('pg').Pool} pool
 * @param {{
 *   ownerEmail: string,
 *   ownerUserId?: string | null,
 *   purpose?: string,
 *   storageProvider: 's3' | 'supabase',
 *   bucket?: string | null,
 *   objectKey: string,
 *   originalFilename: string,
 *   contentType: string,
 *   byteSize: number,
 *   tenantId?: string | null,
 *   entityId?: string | null,
 *   fileCategory?: string | null,
 *   versionNumber?: number | null,
 * }} row
 */
export async function insertStoredFile(pool, row) {
  const id = randomUUID()
  await pool.query(
    `INSERT INTO stored_files (
      id, owner_email, owner_user_id, purpose, storage_provider,
      bucket, object_key, original_filename, content_type, byte_size, status,
      tenant_id, entity_id, file_category, version_number
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ready',$11,$12,$13,$14)`,
    [
      id,
      row.ownerEmail.toLowerCase(),
      row.ownerUserId || null,
      row.purpose || 'resume',
      row.storageProvider,
      row.bucket || null,
      row.objectKey,
      row.originalFilename,
      row.contentType,
      row.byteSize,
      row.tenantId || null,
      row.entityId || null,
      row.fileCategory || row.purpose || 'resume',
      row.versionNumber ?? null,
    ],
  )
  return id
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ tenantId: string, entityId: string, fileCategory?: string }} opts
 */
export async function countStoredFileVersions(pool, opts) {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS c FROM stored_files
     WHERE tenant_id = $1 AND entity_id = $2 AND file_category = $3
       AND deleted_at IS NULL AND status = 'ready'`,
    [opts.tenantId, opts.entityId, opts.fileCategory || 'resume'],
  )
  return res.rows[0]?.c ?? 0
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} fileId
 */
export async function getStoredFileById(pool, fileId) {
  const res = await pool.query(
    `SELECT id, owner_email, owner_user_id, purpose, storage_provider,
            bucket, object_key, original_filename, content_type, byte_size, status, deleted_at
     FROM stored_files WHERE id = $1`,
    [fileId],
  )
  return res.rows[0] || null
}

/**
 * @param {string} requesterEmail
 * @param {{ owner_email: string, deleted_at?: Date | null, status?: string }} fileRow
 */
export function canAccessStoredFile(requesterEmail, fileRow) {
  if (!fileRow || fileRow.deleted_at) return false
  if (fileRow.status && fileRow.status !== 'ready') return false
  return String(requesterEmail || '').toLowerCase() === String(fileRow.owner_email || '').toLowerCase()
}
