import type { EmployerApplicant, EmployerJob } from './store'
import type { OrgCandidateRecord, VendorApplicant, VendorJob } from './vendorApi'

export function vendorJobToEmployerJob(job: VendorJob, createdByEmail: string): EmployerJob {
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    roleTrack: job.roleTrack || job.title,
    experienceLevel: job.experienceLevel || '',
    location: job.location || '',
    jobDescription: job.jobDescription || '',
    requiredSkills: job.requiredSkills || [],
    createdByEmail,
    createdAt: job.createdAt,
    shareableCode: job.shareableCode,
    companySlug: job.companySlug,
  }
}

/** Backend application status → employer dashboard label. */
export function mapApplicantStatusFromApi(status: string): EmployerApplicant['status'] {
  const map: Record<string, EmployerApplicant['status']> = {
    applied: 'New',
    interviewed: 'In Review',
    shortlisted: 'Shortlisted',
    rejected: 'Rejected',
  }
  return map[status] || 'New'
}

export function mapApplicantStatusToApi(status: EmployerApplicant['status']): string {
  const map: Record<EmployerApplicant['status'], string> = {
    New: 'applied',
    'In Review': 'interviewed',
    Shortlisted: 'shortlisted',
    Interviewing: 'interviewed',
    Rejected: 'rejected',
  }
  return map[status] || 'applied'
}

export function mapVendorApplicant(a: VendorApplicant): EmployerApplicant {
  const statusMap: Record<string, EmployerApplicant['status']> = {
    applied: 'New',
    interviewed: 'In Review',
    shortlisted: 'Shortlisted',
    rejected: 'Rejected',
  }
  return {
    id: a.id,
    jobId: a.jobId,
    jobTitle: a.data.jobTitle || '',
    company: a.data.company || '',
    candidateName: a.data.candidateName || a.candidateEmail,
    candidateEmail: a.candidateEmail,
    candidatePhone: a.data.candidatePhone || '',
    role:
      a.data.candidateRole ||
      a.data.roleTrack ||
      (a.data.interviewResult as EmployerApplicant['interviewResult'])?.role ||
      a.data.jobTitle ||
      '',
    experienceYears: a.data.experienceYears || '',
    resumeName: a.data.resumeName || null,
    resumeText: a.data.resumeText,
    interviewResult: a.data.interviewResult as EmployerApplicant['interviewResult'],
    atsScore: a.data.atsScore,
    jdMatchScore: a.data.jdMatchScore,
    primarySkills: a.data.primarySkills,
    appliedAt: a.appliedAt,
    status: statusMap[a.status] || 'New',
  }
}

/** Client-side guard: never show vendor/recruiter rows on the job seeker candidate page. */
export function isJobSeekerCandidateRecord(c: OrgCandidateRecord): boolean {
  const email = c.candidateEmail.trim().toLowerCase()
  if (!email) return false
  if (email.includes('employer@') || email.includes('admin@') || email.includes('recruiter@')) {
    return false
  }
  const name = (c.candidateName || '').toLowerCase()
  if (name.includes('recruiter') && name.includes('employer')) return false
  return true
}

export function filterJobSeekerCandidates(records: OrgCandidateRecord[]): OrgCandidateRecord[] {
  return records.filter(isJobSeekerCandidateRecord)
}

export function mapOrgCandidate(c: OrgCandidateRecord): EmployerApplicant {
  const interviewResult = c.interviewResult as EmployerApplicant['interviewResult']
  const overall =
    typeof interviewResult?.overall === 'number' ? interviewResult.overall : undefined
  return {
    id: c.id,
    jobId: c.jobId || '',
    jobTitle: c.jobTitle || '',
    company: c.company || '',
    candidateName: c.candidateName || c.candidateEmail,
    candidateEmail: c.candidateEmail,
    candidatePhone: c.candidatePhone || '',
    role: c.candidateRole || '',
    experienceYears: c.experienceYears || '',
    resumeName: c.resumeName || null,
    resumeText: c.resumeText,
    interviewResult,
    aiScore: overall,
    atsScore: c.atsScore,
    jdMatchScore: c.jdMatchScore,
    primarySkills: c.primarySkills,
    appliedAt: c.appliedAt,
    status: (c.status as EmployerApplicant['status']) || 'New',
    interviewRecordingAvailable: Boolean(c.interviewRecordingAvailable),
  }
}

export function resumeDisplayLabel(app: EmployerApplicant): string {
  if (app.resumeName?.trim()) return app.resumeName.trim()
  if (app.resumeText?.trim()) return 'Resume'
  return '—'
}

export function hasResumeContent(app: EmployerApplicant): boolean {
  return Boolean(app.resumeName?.trim() || app.resumeText?.trim())
}

export function hasHireRightReport(app: EmployerApplicant): boolean {
  return Boolean(app.interviewResult)
}

export function hasInterviewRecording(app: EmployerApplicant): boolean {
  return Boolean(app.interviewRecordingAvailable)
}

export function downloadResumeFile(app: EmployerApplicant) {
  const text = app.resumeText?.trim()
  if (!text) return
  const name = app.resumeName || `${app.candidateName.replace(/\s+/g, '_')}_resume.txt`
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name.endsWith('.txt') || name.includes('.') ? name : `${name}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

export function hireRightReportPdfName(candidateName: string): string {
  const base = candidateName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${base || 'candidate'}-hireright-report.pdf`
}
