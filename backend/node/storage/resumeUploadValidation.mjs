/** Shared resume upload validation (PDF/DOCX, size limits). */

export const MAX_RESUME_BYTES = 2_000_000
export const RESUME_FILENAME_RE = /\.(pdf|docx)$/i

/**
 * @param {{ filename?: string, file_base64?: string, fileBase64?: string, contentType?: string }} body
 * @returns {{ filename: string, buffer: Buffer, contentType: string | undefined }}
 */
export function parseResumeUploadBody(body) {
  const filename = String(body?.filename || 'resume.pdf').slice(0, 200)
  const raw = String(body?.file_base64 || body?.fileBase64 || '')
  if (!raw || !RESUME_FILENAME_RE.test(filename)) {
    const err = new Error('Upload a PDF or DOCX resume (filename + file_base64).')
    err.status = 400
    throw err
  }
  const base64 = raw.includes(',') ? raw.split(',')[1] : raw
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    const err = new Error('Invalid file_base64 payload.')
    err.status = 400
    throw err
  }
  const buffer = Buffer.from(base64, 'base64')
  if (buffer.length < 1 || buffer.length > MAX_RESUME_BYTES) {
    const err = new Error('Resume must be between 1 byte and 2 MB.')
    err.status = 400
    throw err
  }
  return {
    filename,
    buffer,
    contentType: body?.contentType || undefined,
  }
}

/**
 * @param {string} filename
 * @param {string | undefined} contentType
 */
export function inferResumeContentType(filename, contentType) {
  const explicit = String(contentType || '').trim()
  if (explicit) return explicit
  if (/\.pdf$/i.test(filename)) return 'application/pdf'
  if (/\.docx$/i.test(filename)) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  return 'application/octet-stream'
}
