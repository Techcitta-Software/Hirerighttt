import { apiFetch } from './api'
import { ensureApiSession } from './apiSession'
import { buildScorecardPdfBase64 } from './printScorecard'

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
