import { apiFetch } from './api'
import { ensureApiSession } from './apiSession'

export type ResumeUploadResult = {
  resumeStoragePath: string
  resumeUrl: string
  resumeFileId?: string | null
  storageProvider?: 's3' | 'supabase' | null
  bucket?: string | null
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
      resolve(base64 || '')
    }
    reader.onerror = () => reject(reader.error || new Error('Could not read file'))
    reader.readAsDataURL(file)
  })
}

export type ResumeUploadOutcome =
  | { ok: true; result: ResumeUploadResult }
  | { ok: false; error: string }

const MAX_API_RESUME_BYTES = 2_000_000

/** Upload resume binary to S3 (via Node API) after auth. */
export async function uploadResumeViaApiWithStatus(file: File): Promise<ResumeUploadOutcome> {
  if (file.size > MAX_API_RESUME_BYTES) {
    return {
      ok: false,
      error: 'Resume file must be 2 MB or smaller for secure cloud storage (try a shorter PDF).',
    }
  }
  if (!(await ensureApiSession())) {
    return { ok: false, error: 'Sign in is required to save your resume to secure storage.' }
  }
  const file_base64 = await fileToBase64(file)
  const res = await apiFetch('/api/resume/upload', {
    method: 'POST',
    body: JSON.stringify({
      filename: file.name,
      file_base64,
      contentType: file.type || undefined,
    }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    storagePath?: string
    resumeUrl?: string
    fileId?: string
    storageProvider?: 's3' | 'supabase'
    bucket?: string
    error?: string
    skipped?: boolean
  }
  if (res.status === 503 && data.skipped) {
    return { ok: false, error: data.error || 'Cloud storage is not configured on the server.' }
  }
  if (!res.ok) {
    return { ok: false, error: data.error || `Upload failed (${res.status}).` }
  }
  if (!data.storagePath) {
    return { ok: false, error: 'Upload succeeded but no storage path was returned.' }
  }
  if (!data.resumeUrl && data.storageProvider !== 's3') {
    return { ok: false, error: 'Upload succeeded but download URL is missing.' }
  }
  return {
    ok: true,
    result: {
      resumeStoragePath: data.storagePath,
      resumeUrl: data.resumeUrl || '/api/resume/download',
      resumeFileId: data.fileId ?? null,
      storageProvider: data.storageProvider ?? null,
      bucket: data.bucket ?? null,
    },
  }
}

/** @deprecated Prefer uploadResumeViaApiWithStatus for user-visible errors. */
export async function uploadResumeViaApi(file: File): Promise<ResumeUploadResult | null> {
  const out = await uploadResumeViaApiWithStatus(file)
  return out.ok ? out.result : null
}
