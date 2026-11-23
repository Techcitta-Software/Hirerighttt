import { apiFetch } from './api'
import { cachedRequest, peekCachedRequest } from './requestCache'
import type { IntegrityLogEvent } from './store'

export type VendorJob = {
  id: string
  organizationId: string
  title: string
  company: string
  companySlug?: string
  roleTrack?: string
  experienceLevel?: string
  location?: string
  jobDescription?: string
  requiredSkills?: string[]
  shareableCode: string
  status?: string
  createdAt: string
  /** Number of applications, when the API sends it (saves one applicants request per job). */
  applicantCount?: number
}

export type VendorApplicant = {
  id: string
  organizationId: string
  jobId: string
  candidateEmail: string
  candidateUserId?: string | null
  status: string
  appliedAt: string
  /** Position in the job's ranking (1 = top candidate); null when not interviewed. Set by the applicants API. */
  rank?: number | null
  rankInterviewScore?: number | null
  rankRoleSkillsFit?: number | null
  interviewCompletedAt?: string | null
  data: {
    candidateName?: string
    experienceYears?: string
    atsScore?: number
    jdMatchScore?: number
    resumeSkillCoverage?: number
    primarySkills?: string[]
    interviewScore?: number | null
    interviewResult?: unknown
    resumeFitScore?: number
    jobTitle?: string
    company?: string
    roleTrack?: string
    resumeName?: string
    resumeText?: string
    resumeStoragePath?: string
    resumeFileId?: string
    resumeUrl?: string
    candidatePhone?: string
    candidateRole?: string
    matchedSkills?: string[]
    missingSkills?: string[]
    source?: 'job_board' | 'shared_link' | 'invite' | null
    /** 'job' = interview taken for this job; 'general' = the candidate's latest career interview. */
    interviewSource?: 'job' | 'general'
  }
}

export type TalentSearchHit = {
  userId: string
  email: string
  fullName: string
  roleTitle?: string
  location?: string
  experienceYears?: string
  skills?: string[]
  interviewScore?: number | null
  summary?: string
  resumePreview?: string
}

async function parse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`)
  return data as T
}

export type OpenJobsResponse = {
  jobs: VendorJob[]
  total?: number
  limit?: number
  offset?: number
  scope?: 'matched' | 'all'
  totalOpen?: number
  matchedCount?: number
  candidateRoleHints?: string[]
  personalized?: boolean
  message?: string
  minMatchScore?: number
}

export async function fetchCandidateJobAlerts() {
  const res = await apiFetch('/api/candidate/job-alerts')
  return parse<{ alerts: Array<{ jobId: string; title: string; company: string }> }>(res)
}

export type EmployerApplicationAlert = {
  id: string
  applicationId: string
  jobId: string
  jobTitle: string
  candidateName: string
  candidateEmail: string
  hasInterviewReport: boolean
  hasResume: boolean
  createdAt: string
  read: boolean
}

export async function fetchEmployerApplicationAlerts(opts?: { background?: boolean }) {
  const res = await apiFetch('/api/vendor/application-alerts', { background: opts?.background })
  return parse<{ alerts: EmployerApplicationAlert[]; total: number }>(res)
}

export async function markEmployerApplicationAlertsRead(ids?: string[]) {
  const res = await apiFetch('/api/vendor/application-alerts/read', {
    method: 'POST',
    body: JSON.stringify({ ids: ids ?? null }),
  })
  return parse<{ ok: boolean }>(res)
}

export async function fetchOpenJobs(options?: {
  summary?: boolean
  /** matched = profile role track (default); all = every open posting */
  scope?: 'matched' | 'all'
  limit?: number
  offset?: number
  /** Notification polling: refresh without raising the loading veil. */
  background?: boolean
}) {
  const qs = new URLSearchParams()
  if (options?.summary) qs.set('summary', '1')
  if (options?.scope === 'all') qs.set('scope', 'all')
  else if (options?.scope === 'matched') qs.set('scope', 'matched')
  if (options?.limit != null) qs.set('limit', String(options.limit))
  if (options?.offset != null) qs.set('offset', String(options.offset))
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  const path = `/api/jobs${suffix}`
  // Several components load the same list on mount (page + nav bell): share one request.
  return cachedRequest(path, OPEN_JOBS_SHARE_MS, async () =>
    parse<OpenJobsResponse>(await apiFetch(path, { background: options?.background })),
  )
}

const OPEN_JOBS_SHARE_MS = 5_000
const MATCHED_SUMMARY_PATH = '/api/jobs?summary=1&scope=matched'

/**
 * Matched jobs for the candidate notification bell (first `limit`). Reuses the full matched list
 * when a page has just loaded it (same order, so its first `limit` jobs are the same) instead of
 * sending a second /api/jobs request.
 */
export async function fetchMatchedJobsForAlerts(limit = 30): Promise<VendorJob[]> {
  const shared = peekCachedRequest<OpenJobsResponse>(MATCHED_SUMMARY_PATH)
  if (shared) {
    try {
      return ((await shared).jobs ?? []).slice(0, limit)
    } catch {
      /* fall through to the bell's own small request */
    }
  }
  const res = await fetchOpenJobs({ summary: true, scope: 'matched', limit, background: true })
  return res.jobs ?? []
}

export async function fetchVendorJobs() {
  const res = await apiFetch('/api/vendor/jobs')
  return parse<{ jobs: VendorJob[] }>(res)
}

export async function createVendorJob(payload: {
  title: string
  jobDescription: string
  roleTrack?: string
  experienceLevel?: string
  location?: string
  requiredSkills?: string[]
  company?: string
}) {
  const res = await apiFetch('/api/vendor/jobs', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return parse<{ job: VendorJob }>(res)
}

/** Lifecycle of a vendor job. "active" (older jobs) reads as published. */
export type VendorJobStatus = 'draft' | 'published' | 'closed' | 'archived'

export function vendorJobStatus(job: Pick<VendorJob, 'status'> | null | undefined): VendorJobStatus {
  const s = String(job?.status || 'published').toLowerCase()
  return s === 'draft' || s === 'closed' || s === 'archived' ? s : 'published'
}

export type VendorJobPatch = {
  title?: string
  jobDescription?: string
  requiredSkills?: string[]
  roleTrack?: string
  experienceLevel?: string
  location?: string
  status?: VendorJobStatus
}

/** Edit a job and / or change its status (PATCH /api/vendor/jobs/{id}). */
export async function updateVendorJob(jobId: string, patch: VendorJobPatch) {
  const res = await apiFetch(`/api/vendor/jobs/${encodeURIComponent(jobId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  return parse<{ job: VendorJob; changed: string[] }>(res)
}

export async function deleteVendorJob(jobId: string) {
  const res = await apiFetch(`/api/vendor/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  })
  return parse<{ ok: boolean; id: string; title?: string; candidateApplicationsUpdated?: number }>(
    res,
  )
}

export async function markVendorJobDeletedForCandidates(jobId: string) {
  const res = await apiFetch(
    `/api/vendor/jobs/${encodeURIComponent(jobId)}/mark-deleted-for-candidates`,
    { method: 'POST', body: JSON.stringify({}) },
  )
  return parse<{ ok: boolean; jobId: string; candidateApplicationsUpdated: number }>(res)
}

export async function fetchJobApplicants(jobId: string, opts?: { background?: boolean }) {
  const res = await apiFetch(`/api/vendor/jobs/${encodeURIComponent(jobId)}/applicants`, { background: opts?.background })
  return parse<{ job: VendorJob; applicants: VendorApplicant[]; total: number }>(res)
}

export type OrgCandidateRecord = {
  id: string
  source?: string
  jobId?: string | null
  candidateUserId?: string | null
  candidateEmail: string
  candidateName: string
  candidatePhone?: string
  candidateRole?: string
  experienceYears?: string
  jobTitle?: string
  company?: string
  resumeName?: string | null
  resumeText?: string
  interviewResult?: unknown
  atsScore?: number
  jdMatchScore?: number
  primarySkills?: string[]
  appliedAt: string
  status?: string
  /** Set by GET /api/vendor/candidates — no video URL until recording endpoint is called. */
  interviewRecordingAvailable?: boolean
  /** Set by the API when contact fields were removed (no link to this organisation and no opt-in). */
  contactHidden?: boolean
  /** Every job of the organisation this person applied to (one row per person). */
  appliedJobIds?: string[]
  /** Each of those applications with its own status and scores. */
  applications?: Array<{
    applicationId: string
    jobId: string
    jobTitle?: string
    status?: string
    atsScore?: number | null
    jdMatchScore?: number | null
    appliedAt?: string
    interviewScore?: number | null
    interviewed?: boolean
  }>
  /** The job the attached interview was taken for. */
  interviewJobId?: string | null
}

export type VendorCandidateRecordingLink = VendorCandidateDocumentLink & {
  playbackUrl: string
  durationSeconds?: number | null
  fileSizeBytes?: number | null
}

export type VendorCandidateDocumentLink = {
  viewUrl: string
  downloadUrl: string
  expiresInSeconds: number | null
  contentType: string
  filename: string
  sessionId?: string
}

export async function fetchVendorCandidateResumeDocument(candidateEmail: string) {
  const qs = new URLSearchParams({ email: candidateEmail })
  const res = await apiFetch(`/api/vendor/candidate-documents/resume?${qs}`)
  return parse<VendorCandidateDocumentLink>(res)
}

/** The stored resume file itself (via the API, so the browser needs no cross-origin S3 access). */
export async function fetchVendorCandidateResumeFile(candidateEmail: string): Promise<ArrayBuffer> {
  const qs = new URLSearchParams({ email: candidateEmail, raw: '1' })
  const res = await apiFetch(`/api/vendor/candidate-documents/resume?${qs}`)
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error || `Could not load the resume (${res.status})`)
  }
  return res.arrayBuffer()
}

export async function fetchVendorCandidateReportDocument(candidateEmail: string) {
  const qs = new URLSearchParams({ email: candidateEmail })
  const res = await apiFetch(`/api/vendor/candidate-documents/report?${qs}`)
  return parse<VendorCandidateDocumentLink>(res)
}

/** Presigned S3 URL for HTML5 streaming (byte-range requests handled by S3). */
export async function fetchVendorCandidateRecordingDocument(
  candidateEmail: string,
  sessionId?: string | null,
) {
  const qs = new URLSearchParams({ email: candidateEmail })
  if (sessionId) qs.set('sessionId', sessionId)
  const res = await apiFetch(`/api/vendor/candidate-documents/recording?${qs}`)
  return parse<VendorCandidateRecordingLink>(res)
}

export type VendorInterviewReviewPayload = {
  events: IntegrityLogEvent[]
  proctoring?: import('./store').InterviewProctoringSummary | null
  videoUrl: string | null
  recordingStatus: string
}

export async function fetchVendorInterviewReview(sessionId: string, candidateEmail: string) {
  const qs = new URLSearchParams({ sessionId, email: candidateEmail })
  const res = await apiFetch(`/api/vendor/interview-review?${qs}`)
  return parse<VendorInterviewReviewPayload>(res)
}

export async function fetchOrganizationCandidates(params?: {
  name?: string
  job?: string
  experienceYears?: string
  keywords?: string
  jobId?: string
  /** 'org' = this organisation's applicants. 'all' = platform talent pool (explicit opt-in). Default: org. */
  scope?: 'org' | 'all'
}, opts?: { background?: boolean }) {
  const qs = new URLSearchParams()
  const scope = params?.scope ?? 'org'
  if (scope === 'org') qs.set('scope', 'org')
  if (params?.name) qs.set('name', params.name)
  if (params?.job) qs.set('job', params.job)
  if (params?.experienceYears) qs.set('experienceYears', params.experienceYears)
  if (params?.keywords) qs.set('keywords', params.keywords)
  if (params?.jobId) qs.set('jobId', params.jobId)
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  const res = await apiFetch(`/api/vendor/candidates${suffix}`, { background: opts?.background })
  return parse<{ organizationId: string; total: number; candidates: OrgCandidateRecord[] }>(res)
}

export async function fetchJobCandidatesRoster(
  jobId: string,
  params?: {
    name?: string
    job?: string
    experienceYears?: string
    keywords?: string
  },
) {
  const qs = new URLSearchParams()
  if (params?.name) qs.set('name', params.name)
  if (params?.job) qs.set('job', params.job)
  if (params?.experienceYears) qs.set('experienceYears', params.experienceYears)
  if (params?.keywords) qs.set('keywords', params.keywords)
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  const res = await apiFetch(`/api/vendor/jobs/${encodeURIComponent(jobId)}/candidates${suffix}`)
  return parse<{
    job: VendorJob
    organizationId: string
    total: number
    candidates: OrgCandidateRecord[]
  }>(res)
}

export type ApplicantInterviewPlan = {
  questionMode: 'adaptive' | 'employer' | 'individual_jd' | 'resume_only'
  role: string
  level: string
  skillAnalysis: {
    jdSkills: string[]
    matchedSkills: string[]
    missingSkills: string[]
    atsScore: number
    jdMatchScore: number
    resumeSkillCoverage?: number
  }
  questions: { text: string; category?: string; topic?: string }[]
}

export async function fetchApplicantInterviewPlan(applicantId: string) {
  const res = await apiFetch(`/api/vendor/applicants/${applicantId}/interview-plan`)
  return parse<ApplicantInterviewPlan>(res)
}

export async function sendApplicantInterviewInvite(
  applicantId: string,
  payload: { scheduledStart: string; durationMinutes?: number },
) {
  const res = await apiFetch(`/api/vendor/applicants/${applicantId}/interview-invite`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return parse<{
    invite: {
      inviteUrl: string
      scheduledStart: string
      scheduledEnd: string
      emailSent: boolean
      emailError?: string | null
      smtpConfigured: boolean
    }
  }>(res)
}

export type SentInvite = {
  email: string
  name?: string
  inviteUrl: string
  emailSent: boolean
  emailError?: string | null
}

/** Email an open interview link to one or many people (resume-based AI interview opens directly). */
export async function sendInterviewLinks(payload: {
  candidates: { email: string; name?: string }[]
  jobId?: string
  expiresInDays?: number
}) {
  const res = await apiFetch('/api/vendor/interview-invites/send', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return parse<{ ok: boolean; expiresAt: string; smtpConfigured: boolean; invites: SentInvite[] }>(res)
}

export async function patchApplicantStatus(applicantId: string, status: string) {
  const res = await apiFetch(`/api/vendor/applicants/${applicantId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
  return parse<{ application: VendorApplicant }>(res)
}

export async function fetchPublicJob(code: string, companySlug?: string) {
  const path = companySlug
    ? `/api/jobs/public/${encodeURIComponent(companySlug)}/${encodeURIComponent(code)}`
    : `/api/jobs/public/${encodeURIComponent(code)}`
  const res = await apiFetch(path)
  return parse<{ job: VendorJob }>(res)
}

export async function applyToPublicJob(
  code: string,
  payload: {
    candidateName: string
    candidateEmail: string
    candidatePhone?: string
    candidateRole?: string
    experienceYears?: string
    resumeText: string
    resumeName?: string
    attachInterviewReport?: boolean
    match?: number
    /** Where the candidate applied from — shown to the vendor on the job's applicant list. */
    source?: 'job_board' | 'shared_link' | 'invite'
  },
  companySlug?: string,
) {
  const base = companySlug
    ? `/api/jobs/public/${encodeURIComponent(companySlug)}/${encodeURIComponent(code)}/apply`
    : `/api/jobs/public/${encodeURIComponent(code)}/apply`
  const res = await apiFetch(base, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return parse<{
    applicationId: string
    job: VendorJob
    ats: {
      atsScore: number
      jdMatchScore: number
      primarySkills: string[]
      matchedSkills: string[]
      missingSkills: string[]
      strengths?: string[]
      gaps?: string[]
      summary?: string
      aiEnhanced?: boolean
    }
    organizationId: string
  }>(res)
}

export type VendorAssessmentReport = {
  generatedAt: string
  candidateName: string
  jobTitle: string
  company: string
  atsScore: number | null
  jdMatchScore: number | null
  interviewOverall: number | null
  resumeFitScore?: number | null
  compositeScore: number | null
  executiveSummary: string
  atsAnalysis: string
  skillAlignment: { skill: string; status: string; evidence: string }[]
  interviewHighlights: string[]
  categoryNarratives: { label: string; score: number; narrative: string }[]
  risksAndGaps: string[]
  recommendation: string
  confidence: string
  aiGenerated: boolean
}

export async function fetchApplicantReport(applicantId: string, opts?: { refresh?: boolean }) {
  const qs = opts?.refresh ? '?refresh=1' : ''
  const res = await apiFetch(`/api/vendor/applicants/${applicantId}/report${qs}`)
  return parse<{ report: VendorAssessmentReport; application: VendorApplicant }>(res)
}

export async function searchTalent(params: {
  q?: string
  skills?: string
  location?: string
  experienceYears?: string
  minScore?: number
  limit?: number
  offset?: number
}) {
  const qs = new URLSearchParams()
  if (params.q) qs.set('q', params.q)
  if (params.skills) qs.set('skills', params.skills)
  if (params.location) qs.set('location', params.location)
  if (params.experienceYears) qs.set('experienceYears', params.experienceYears)
  if (params.minScore != null) qs.set('minScore', String(params.minScore))
  if (params.limit != null) qs.set('limit', String(params.limit))
  if (params.offset != null) qs.set('offset', String(params.offset))
  const res = await apiFetch(`/api/talent/search?${qs.toString()}`)
  return parse<{ total: number; candidates: TalentSearchHit[] }>(res)
}
