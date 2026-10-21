import { uploadResumeToSupabase, supabaseStorageConfigured } from '../resumeStorage.mjs'
import { inferResumeContentType } from './resumeUploadValidation.mjs'
import {
  buildObjectKey,
  createS3ObjectStorage,
  defaultS3ObjectStorage,
  s3StorageConfigured,
} from './s3ObjectStorage.mjs'
import { canAccessStoredFile, getStoredFileById, insertStoredFile } from './storedFilesRepo.mjs'

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
    const objectKey = buildObjectKey(email, 'resumes', opts.filename)
    const { bucket } = await s3.uploadObject({
      key: objectKey,
      buffer: opts.buffer,
      contentType,
      metadata: {
        purpose: 'resume',
        owner: email.replace(/[^a-z0-9._-]+/g, '_'),
      },
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
    if (row.storage_provider === 's3') {
      const s3 = opts.s3 || defaultS3ObjectStorage
      const head = await s3.headObject({ key: row.object_key })
      if (!head) {
        const err = new Error('Resume file is missing from storage.')
        err.status = 404
        throw err
      }
      const disposition = `attachment; filename="${row.original_filename.replace(/"/g, '')}"`
      return s3.presignDownload({ key: row.object_key, responseContentDisposition: disposition })
    }
    if (row.storage_provider === 'supabase' && profile.resumeUrl) {
      return { url: String(profile.resumeUrl), expiresInSeconds: null, legacyPublic: true }
    }
  }

  const provider = String(profile.storageProvider || '')
  if (provider === 'supabase' && profile.resumeUrl) {
    return { url: String(profile.resumeUrl), expiresInSeconds: null, legacyPublic: true }
  }

  if (provider === 's3' && profile.resumeStoragePath) {
    const s3 = opts.s3 || defaultS3ObjectStorage
    const key = String(profile.resumeStoragePath)
    const head = await s3.headObject({ key })
    if (!head) {
      const err = new Error('Resume file is missing from storage.')
      err.status = 404
      throw err
    }
    const name = String(profile.resumeName || 'resume.pdf')
    return s3.presignDownload({
      key,
      responseContentDisposition: `attachment; filename="${name.replace(/"/g, '')}"`,
    })
  }

  const err = new Error('No stored resume file for this account.')
  err.status = 404
  throw err
}
