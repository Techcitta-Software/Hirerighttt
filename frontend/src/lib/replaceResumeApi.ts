import { apiFetch } from './api'
import { ensureApiSession } from './apiSession'
import type { ResumeExtract } from './resumeParser'
import { resumeExtractToProfilePatch } from './resumeParser'
import type { SavedProfile } from './store'

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

export type ReplaceResumeOutcome =
  | { ok: true; profile: SavedProfile }
  | { ok: false; error: string }

/** Replace résumé in place: server purges old S3/interview artifacts and stores new profile. */
export async function replaceResumeViaApi(
  file: File,
  extract: ResumeExtract,
): Promise<ReplaceResumeOutcome> {
  if (!(await ensureApiSession())) {
    return { ok: false, error: 'Sign in is required to update your résumé.' }
  }
  if (file.size > 2_000_000) {
    return { ok: false, error: 'Résumé must be 2 MB or smaller.' }
  }

  const patch = resumeExtractToProfilePatch(extract)
  const resumeText = extract.resumeText || patch.resumeText || ''

  const file_base64 = await fileToBase64(file)
  const res = await apiFetch('/api/resume/replace', {
    method: 'POST',
    body: JSON.stringify({
      filename: file.name,
      file_base64,
      contentType: file.type || undefined,
      resumeText,
      extract: { ...patch, resumeText },
    }),
  })

  const data = (await res.json().catch(() => ({}))) as {
    profile?: SavedProfile
    error?: string
    skipped?: boolean
  }

  if (!res.ok) {
    return { ok: false, error: data.error || `Replace failed (${res.status}).` }
  }
  if (!data.profile) {
    return { ok: false, error: 'Server did not return an updated profile.' }
  }
  return { ok: true, profile: data.profile }
}
