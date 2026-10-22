/** User-safe message for S3/IAM failures — full detail stays in server logs. */
export const GENERIC_STORAGE_ERROR =
  'Secure file storage is temporarily unavailable. Please try again in a few minutes.'

/**
 * @param {unknown} err
 * @param {string} [fallback]
 */
export function publicObjectStorageError(err, fallback = GENERIC_STORAGE_ERROR) {
  const msg = err instanceof Error ? err.message : String(err || '')
  if (!msg.trim()) return fallback
  if (/arn:aws:/i.test(msg)) return fallback
  if (/not authorized|accessdenied|invalidaccesskeyid|signaturedoesnotmatch|nosuchbucket|permanentredirect/i.test(msg)) {
    return fallback
  }
  if (msg.length > 180) return fallback
  return msg
}
