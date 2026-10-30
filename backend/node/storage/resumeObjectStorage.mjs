import { uploadResumeToSupabase, supabaseStorageConfigured } from '../resumeStorage.mjs'
import { inferResumeContentType } from './resumeUploadValidation.mjs'
import {
  createS3ObjectStorage,
  defaultS3ObjectStorage,
  s3StorageConfigured,
} from './s3ObjectStorage.mjs'
import {
  buildCandidateResumeObjectKey,
  isLegacyResumeObjectKey,
  resolveTenantId,
} from './s3KeyLayout.mjs'
import { buildS3UserMetadata, resolveCandidateStorageId, S3_OBJECT_PURPOSES } from './s3Namespace.mjs'
import { neonRowUsesActiveS3Bucket } from './s3ActiveBucketGate.mjs'
import {
  canAccessStoredFile,
  countStoredFileVersions,
  getStoredFileById,
  insertStoredFile,
} from './storedFilesRepo.mjs'

/** Authenticated API path — never a public object URL for S3. */
export const RESUME_DOWNLOAD_API_PATH = '/api/resume/download'

export function objectStorageConfigured() {
  if (s3StorageConfigured()) return true
  if (process.env.DISABLE_SUPABASE === 'true') return false
  return supabaseStorageConfigured()
}

/**
 * Prefer S3 when configured; fall back to Supabase for backward compatibility.
 *
 * @param {import('pg').Pool} pool
 * @param {{
 *   candidateEmail: string,
 *   ownerUserId?: string | null,
 *   primaryOrganizationId?: string | null,
 *   filename: string,
 *   buffer: Buffer,
 *   contentType?: string,
 *   s3?: ReturnType<typeof createS3ObjectStorage>,
 * }} opts
 */
export async function uploadResumeToObjectStorage(opts) {
  const contentType = inferResumeContentType(opts.filename, opts.contentType)
  const email = String(opts.candidateEmail || '').toLowerCase()

  if (s3StorageConfigured()) {
    const s3 = opts.s3 || defaultS3ObjectStorage
    const candidateId = resolveCandidateStorageId({
      account: opts.ownerUserId ? { id: opts.ownerUserId } : null,
      email,
    })
    const tenantId = resolveTenantId({
      user: {
        id: opts.ownerUserId,
        primaryOrganizationId: opts.primaryOrganizationId,
      },
    })
    let versionNumber = 1
    try {
      const existing = await countStoredFileVersions(opts.pool, {
        tenantId,
        entityId: candidateId,
        fileCategory: 'resume',
      })
      versionNumber = existing + 1
    } catch {
      versionNumber = 1
    }
    const objectKey = buildCandidateResumeObjectKey({
      tenantId,
      candidateId,
      originalFilename: opts.filename,
      versionNumber,
    })
    const { bucket } = await s3.uploadObject({
      key: objectKey,
      buffer: opts.buffer,
      contentType,
      metadata: buildS3UserMetadata({
        purpose: S3_OBJECT_PURPOSES.resume,
        tenantId,
        candidateId,
      }),
    })
    let fileId = null
    try {
      fileId = await insertStoredFile(opts.pool, {
        ownerEmail: email,
        ownerUserId: opts.ownerUserId,
        purpose: 'resume',
        storageProvider: 's3',
        bucket,
        objectKey,
        originalFilename: opts.filename,
        contentType,
        byteSize: opts.buffer.length,
        tenantId,
        entityId: candidateId,
        fileCategory: 'resume',
        versionNumber,
      })
    } catch (dbErr) {
      console.warn(
        '[resume-upload] S3 object saved but stored_files insert failed — run npm run db:init',
        dbErr instanceof Error ? dbErr.message : dbErr,
      )
    }
    return {
      storageProvider: 's3',
      bucket,
      storagePath: objectKey,
      fileId,
      resumeUrl: RESUME_DOWNLOAD_API_PATH,
    }
  }

  if (process.env.DISABLE_SUPABASE !== 'true' && supabaseStorageConfigured()) {
    const uploaded = await uploadResumeToSupabase({
      candidateEmail: email,
      filename: opts.filename,
      buffer: opts.buffer,
      contentType,
    })
    let fileId = null
    try {
      fileId = await insertStoredFile(opts.pool, {
        ownerEmail: email,
        ownerUserId: opts.ownerUserId,
        purpose: 'resume',
        storageProvider: 'supabase',
        bucket: uploaded.bucket,
        objectKey: uploaded.storagePath,
        originalFilename: opts.filename,
        contentType,
        byteSize: opts.buffer.length,
      })
    } catch {
      // Metadata insert is best-effort for legacy Supabase path.
    }
    return {
      storageProvider: 'supabase',
      bucket: uploaded.bucket,
      storagePath: uploaded.storagePath,
      fileId,
      resumeUrl: uploaded.resumeUrl,
    }
  }

  const err = new Error('Object storage is not configured (set S3_BUCKET + AWS_REGION, or Supabase).')
  err.status = 503
  err.skipped = true
  throw err
}

/**
 * @param {{
 *   requesterEmail: string,
 *   profile: Record<string, unknown>,
 *   pool: import('pg').Pool,
 *   s3?: ReturnType<typeof createS3ObjectStorage>,
 * }} opts
 */
/**
 * Presign resume bytes from profile metadata (no ownership check — caller must authorize).
 * @param {Record<string, unknown>} profile
 * @param {import('pg').Pool} pool
 * @param {{ inline?: boolean, s3?: ReturnType<typeof createS3ObjectStorage> }} [options]
 */
export async function resolveResumeDownloadFromProfile(profile, pool, options = {}) {
  const fileId = profile.resumeFileId ? String(profile.resumeFileId) : ''
  const dispositionMode = options.inline ? 'inline' : 'attachment'

  if (fileId) {
    const row = await getStoredFileById(pool, fileId)
    if (!row || row.deleted_at || (row.status && row.status !== 'ready')) {
      const err = new Error('Resume file not found.')
      err.status = 404
      throw err
    }
    if (row.storage_provider === 's3') {
      if (!neonRowUsesActiveS3Bucket(row)) {
        const err = new Error('Resume file is not available in current storage.')
        err.status = 404
        throw err
      }
      const s3 = options.s3 || defaultS3ObjectStorage
      const head = await s3.headObject({ key: row.object_key })
      if (!head) {
        const err = new Error('Resume file is missing from storage.')
        err.status = 404
        throw err
      }
      const disposition = `${dispositionMode}; filename="${row.original_filename.replace(/"/g, '')}"`
      const signed = await s3.presignDownload({ key: row.object_key, responseContentDisposition: disposition })
      return {
        ...signed,
        contentType: row.content_type || 'application/pdf',
        filename: row.original_filename,
      }
    }
    if (row.storage_provider === 'supabase' && profile.resumeUrl) {
      return {
        url: String(profile.resumeUrl),
        expiresInSeconds: null,
        legacyPublic: true,
        contentType: row.content_type || 'application/pdf',
        filename: row.original_filename,
      }
    }
  }

  const provider = String(profile.storageProvider || '')
  if (provider === 'supabase' && profile.resumeUrl) {
    return {
      url: String(profile.resumeUrl),
      expiresInSeconds: null,
      legacyPublic: true,
      contentType: 'application/pdf',
      filename: String(profile.resumeName || 'resume.pdf'),
    }
  }

  if (provider === 's3' && profile.resumeStoragePath) {
    const s3 = options.s3 || defaultS3ObjectStorage
    const key = String(profile.resumeStoragePath)
    const allowedPrefix =
      key.startsWith('users/') ||
      key.startsWith('tenants/') ||
      key.startsWith('candidates/') ||
      isLegacyResumeObjectKey(key)
    if (!allowedPrefix) {
      const err = new Error('Resume file not found.')
      err.status = 404
      throw err
    }
    const head = await s3.headObject({ key })
    if (!head) {
      const err = new Error('Resume file is missing from storage.')
      err.status = 404
      throw err
    }
    const name = String(profile.resumeName || 'resume.pdf')
    const signed = await s3.presignDownload({
      key,
      responseContentDisposition: `${dispositionMode}; filename="${name.replace(/"/g, '')}"`,
    })
    return {
      ...signed,
      contentType: inferResumeContentType(name),
      filename: name,
    }
  }

  const err = new Error('No stored resume file for this account.')
  err.status = 404
  throw err
}

export async function resolveResumeDownloadForUser(opts) {
  const email = String(opts.requesterEmail || '').toLowerCase()
  const profile = opts.profile || {}
  const fileId = profile.resumeFileId ? String(profile.resumeFileId) : ''
  if (fileId) {
    const row = await getStoredFileById(opts.pool, fileId)
    if (!canAccessStoredFile(email, row)) {
      const err = new Error('Resume file not found.')
      err.status = 404
      throw err
    }
  }
  return resolveResumeDownloadFromProfile(profile, opts.pool, { s3: opts.s3 })
}
