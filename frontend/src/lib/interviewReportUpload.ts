import { apiFetch } from './api'
import { ensureApiSession } from './apiSession'
import { buildScorecardPdfBase64 } from './printScorecard'

/** Presigned URL for the server-generated scorecard PDF in S3. */
export async function fetchStoredReportDownloadUrl(sessionId: string): Promise<string | null> {
  if (!sessionId || !(await ensureApiSession())) return null
  try {
    const res = await apiFetch(
      `/api/interview/artifacts/${encodeURIComponent(sessionId)}/report/download?format=json`,
    )
    if (!res.ok) return null
    const data = (await res.json().catch(() => ({}))) as { downloadUrl?: string }
    return data.downloadUrl || null
  } catch {
    return null
  }
}

/** Poll until background HTML→PDF upload finishes after /api/interview/score. */
export async function waitForStoredReportPdf(sessionId: string, maxMs = 45_000): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < maxMs) {
    const url = await fetchStoredReportDownloadUrl(sessionId)
    if (url) return true
    await new Promise((r) => window.setTimeout(r, 2000))
  }
  return false
}

export async function openStoredScorecardPdf(sessionId: string): Promise<boolean> {
  const url = await fetchStoredReportDownloadUrl(sessionId)
  if (!url) return false
  window.open(url, '_blank', 'noopener,noreferrer')
  return true
}

/** Legacy browser screenshot upload — fallback if server PDF is unavailable. */
export async function uploadInterviewReportPdfToS3(sessionId: string): Promise<boolean> {
  if (!sessionId || !(await ensureApiSession())) return false
  try {
    const file_base64 = await buildScorecardPdfBase64()
    const res = await apiFetch('/api/interview/artifacts/report', {
      method: 'POST',
      body: JSON.stringify({ sessionId, file_base64 }),
    })
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; skipped?: boolean }
      if (data.skipped) return false
      console.warn('[interview-report] S3 upload failed:', data.error || res.status)
      return false
    }
    return true
  } catch (err) {
    console.warn('[interview-report] S3 upload error', err)
    return false
  }
}
