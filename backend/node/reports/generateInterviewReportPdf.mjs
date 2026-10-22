import { renderCareerScorecardHtml } from './renderCareerScorecardHtml.mjs'
import { htmlToPdfBuffer } from './htmlToPdf.mjs'
import { persistInterviewReportPdfBuffer } from '../storage/interviewArtifactStorage.mjs'

/**
 * HTML template → PDF → S3 (same key as browser upload path).
 * @param {{
 *   pool: import('pg').Pool,
 *   db: { interviewSessions?: Record<string, unknown> },
 *   requesterEmail: string,
 *   account?: { id?: string, primaryOrganizationId?: string, name?: string } | null,
 *   sessionId: string,
 *   result: Record<string, unknown>,
 *   candidateName?: string,
 *   candidateRole?: string,
 *   candidateExperience?: string,
 *   skills?: string[],
 *   s3?: import('../storage/s3ObjectStorage.mjs').createS3ObjectStorage extends (...args: any) => infer R ? R : never,
 * }} opts
 */
export async function generateAndPersistInterviewReportPdf(opts) {
  const email = String(opts.requesterEmail || '').toLowerCase()
  const profiles = /** @type {Record<string, Record<string, unknown>>} */ (opts.db.profiles || {})
  const profile = profiles[email] || {}
  const candidateName =
    opts.candidateName ||
    opts.account?.name ||
    String(profile.fullName || profile.name || email)

  const html = renderCareerScorecardHtml({
    result: opts.result,
    candidateName,
    candidateRole: opts.candidateRole || String(profile.currentRole || opts.result.role || ''),
    candidateExperience: opts.candidateExperience || String(profile.totalExperience || ''),
    skills: opts.skills || (Array.isArray(profile.skills) ? profile.skills.map(String) : []),
  })

  const buffer = await htmlToPdfBuffer(html)
  const out = await persistInterviewReportPdfBuffer({
    pool: opts.pool,
    db: opts.db,
    requesterEmail: email,
    account: opts.account,
    sessionId: opts.sessionId,
    buffer,
    s3: opts.s3,
  })
  return { ...out, byteSize: buffer.length }
}
