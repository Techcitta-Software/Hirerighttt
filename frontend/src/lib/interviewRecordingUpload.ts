import { apiFetch } from './api'
import { ensureApiSession } from './apiSession'

export type RecordingUploadOutcome =
  | { ok: true; recordingId: string; objectKey: string }
  | { ok: false; error: string; skipped?: boolean }

export type InterviewRecordingPlayback = {
  playbackUrl: string
  durationSeconds?: number | null
  contentType?: string
}

export function interviewRecordingFilename(sessionId: string, blob: Blob): string {
  const base = `interview_${sessionId.slice(0, 8)}`
  const type = (blob.type || '').toLowerCase()
  if (type.includes('mp4')) return `${base}.mp4`
  return `${base}.webm`
}

/**
 * Upload the interview video through the API. The Python server stores it with boto3.
 */
export async function uploadInterviewRecordingToS3(opts: {
  sessionId: string
  blob: Blob
  durationMs: number
  filename?: string
}): Promise<RecordingUploadOutcome> {
  if (!(await ensureApiSession())) {
    return { ok: false, error: 'Sign in is required to save your interview recording.' }
  }
  const filename =
    opts.filename || interviewRecordingFilename(opts.sessionId, opts.blob)
  const form = new FormData()
  form.append('sessionId', opts.sessionId)
  form.append('filename', filename)
  form.append('durationSeconds', String(Math.round(opts.durationMs / 1000)))
  form.append('file', opts.blob, filename)
  const initRes = await apiFetch('/api/interview/recordings/upload', {
    method: 'POST',
    body: form,
    signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(120_000) : undefined,
  })
  const init = (await initRes.json().catch(() => ({}))) as {
    error?: string
    skipped?: boolean
    recordingId?: string
    objectKey?: string
  }
  if (initRes.status === 503 && init.skipped) {
    return { ok: false, error: init.error || 'Cloud recording storage is not configured.', skipped: true }
  }
  if (!initRes.ok || !init.recordingId) {
    return { ok: false, error: init.error || `Could not save recording (${initRes.status}).` }
  }
  return {
    ok: true,
    recordingId: init.recordingId,
    objectKey: init.objectKey || '',
  }
}

/** Presigned GET for the candidate’s own full interview video (S3). */
export async function fetchInterviewRecordingPlayback(
  sessionId: string,
): Promise<InterviewRecordingPlayback | null> {
  if (!(await ensureApiSession()) || !sessionId.trim()) return null
  const res = await apiFetch(
    `/api/interview/recordings/playback?sessionId=${encodeURIComponent(sessionId)}`,
  )
  const data = (await res.json().catch(() => ({}))) as {
    playbackUrl?: string
    viewUrl?: string
    durationSeconds?: number
    contentType?: string
    error?: string
    skipped?: boolean
  }
  if (res.status === 404 || (res.status === 503 && data.skipped)) return null
  if (!res.ok) {
    throw new Error(data.error || `Could not load recording (${res.status}).`)
  }
  const playbackUrl = data.playbackUrl || data.viewUrl
  if (!playbackUrl) return null
  return {
    playbackUrl,
    durationSeconds: data.durationSeconds,
    contentType: data.contentType,
  }
}
