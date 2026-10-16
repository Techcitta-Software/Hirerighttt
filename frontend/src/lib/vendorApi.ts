import { apiFetch } from './api'

export type VendorJob = {
  id: string
  organizationId: string
  title: string
  company: string
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

export async function fetchJobApplicants(jobId: string) {
  const res = await apiFetch(`/api/vendor/jobs/${jobId}/applicants`)
  return parse<{ job: VendorJob; applicants: VendorApplicant[] }>(res)
}

export async function patchApplicantStatus(applicantId: string, status: string) {
  const res = await apiFetch(`/api/vendor/applicants/${applicantId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
  return parse<{ application: VendorApplicant }>(res)
}

export async function fetchPublicJob(code: string) {
  const res = await apiFetch(`/api/jobs/public/${encodeURIComponent(code)}`)
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
) {
  const res = await apiFetch(`/api/jobs/public/${encodeURIComponent(code)}/apply`, {
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

export async function fetchApplicantReport(applicantId: string) {
  const res = await apiFetch(`/api/vendor/applicants/${applicantId}/report`)
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
  return parse<{ total: number; results: TalentSearchHit[] }>(res)
}
