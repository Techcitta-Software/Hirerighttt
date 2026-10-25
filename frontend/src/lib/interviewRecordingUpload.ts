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
 * Direct presigned PUT to S3 (auth + session validated on upload-url).
 * Falls back gracefully when S3 is not configured.
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
  const initRes = await apiFetch('/api/interview/recordings/upload-url', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: opts.sessionId,
      filename,
      contentType: opts.blob.type || 'video/webm',
      fileSize: opts.blob.size,
    }),
  })
  const init = (await initRes.json().catch(() => ({}))) as {
    error?: string
    skipped?: boolean
    recordingId?: string
    objectKey?: string
    uploadUrl?: string
    contentType?: string
  }
  if (initRes.status === 503 && init.skipped) {
    return { ok: false, error: init.error || 'Cloud recording storage is not configured.', skipped: true }
  }
  if (!initRes.ok || !init.uploadUrl || !init.recordingId) {
    return { ok: false, error: init.error || `Could not start recording upload (${initRes.status}).` }
  }

  const putRes = await fetch(init.uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': init.contentType || opts.blob.type || 'video/webm',
    },
    body: opts.blob,
  })
  if (!putRes.ok) {
    return { ok: false, error: `S3 upload failed (${putRes.status}). Try again.` }
  }

  const doneRes = await apiFetch('/api/interview/recordings/complete', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: opts.sessionId,
      recordingId: init.recordingId,
      durationSeconds: Math.round(opts.durationMs / 1000),
    }),
  })
  const done = (await doneRes.json().catch(() => ({}))) as { error?: string; objectKey?: string }
  if (!doneRes.ok) {
    return { ok: false, error: done.error || 'Upload finished but metadata save failed.' }
  }
  return {
    ok: true,
    recordingId: init.recordingId,
    objectKey: done.objectKey || init.objectKey || '',
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
