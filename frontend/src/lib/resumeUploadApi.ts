import { apiFetch } from './api'
import { ensureApiSession } from './apiSession'

export type ResumeUploadResult = {
  resumeStoragePath: string
  resumeUrl: string
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

/** Upload resume binary to Supabase (via Node API) after auth. */
export async function uploadResumeViaApi(file: File): Promise<ResumeUploadResult | null> {
  if (!(await ensureApiSession())) return null
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
    error?: string
    skipped?: boolean
  }
  if (res.status === 503 && data.skipped) return null
  if (!res.ok) {
    console.warn('[resumeUpload]', data.error || res.status)
    return null
  }
  if (!data.storagePath || !data.resumeUrl) return null
  return { resumeStoragePath: data.storagePath, resumeUrl: data.resumeUrl }
}
