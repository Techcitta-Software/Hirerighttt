import { apiFetch } from './api'

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
}

export type VendorApplicant = {
  id: string
  organizationId: string
  jobId: string
  candidateEmail: string
  candidateUserId?: string | null
  status: string
  appliedAt: string
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
    candidatePhone?: string
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
}

export async function fetchOpenJobs(options?: {
  summary?: boolean
  limit?: number
  offset?: number
}) {
  const qs = new URLSearchParams()
  if (options?.summary) qs.set('summary', '1')
  if (options?.limit != null) qs.set('limit', String(options.limit))
  if (options?.offset != null) qs.set('offset', String(options.offset))
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  const res = await apiFetch(`/api/jobs${suffix}`)
  return parse<OpenJobsResponse>(res)
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

export async function deleteVendorJob(jobId: string) {
  const res = await apiFetch(`/api/vendor/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  })
  return parse<{ ok: boolean; id: string; title?: string }>(res)
}

export async function fetchJobApplicants(jobId: string) {
  const res = await apiFetch(`/api/vendor/jobs/${jobId}/applicants`)
  return parse<{ job: VendorJob; applicants: VendorApplicant[] }>(res)
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
}

export async function fetchOrganizationCandidates(params?: {
  name?: string
  job?: string
  experienceYears?: string
  keywords?: string
  jobId?: string
}) {
  const qs = new URLSearchParams()
  if (params?.name) qs.set('name', params.name)
  if (params?.job) qs.set('job', params.job)
  if (params?.experienceYears) qs.set('experienceYears', params.experienceYears)
  if (params?.keywords) qs.set('keywords', params.keywords)
  if (params?.jobId) qs.set('jobId', params.jobId)
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  const res = await apiFetch(`/api/vendor/candidates${suffix}`)
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
    experienceYears?: string
    resumeText: string
    resumeName?: string
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
