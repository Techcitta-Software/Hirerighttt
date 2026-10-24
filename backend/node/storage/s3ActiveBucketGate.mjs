import { s3Env, s3StorageConfigured } from './s3ObjectStorage.mjs'

/** Bucket name from repo-root .env — sole target for all S3 API calls. */
export function activeS3BucketName() {
  if (!s3StorageConfigured()) return ''
  return s3Env().bucket
}

/**
 * Neon file metadata must reference the active bucket (ignores rows from a prior AWS account/bucket).
 * @param {{ bucket?: string | null } | null | undefined} row
 */
export function neonRowUsesActiveS3Bucket(row) {
  if (!row) return false
  const active = activeS3BucketName()
  if (!active) return false
  const rowBucket = String(row.bucket || '').trim()
  return rowBucket === active
}

/**
 * @param {{ bucket?: string | null } | null | undefined} row
 */
export function rejectUnlessActiveS3Bucket(row, notFoundMessage = 'File not found in current storage.') {
  if (!neonRowUsesActiveS3Bucket(row)) {
    const err = new Error(notFoundMessage)
    err.status = 404
    throw err
  }
}
