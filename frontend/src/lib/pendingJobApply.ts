import { getProfile, getUser } from './store'
import { applyToPublicJob, type VendorJob } from './vendorApi'
import { ensureApiSession } from './apiSession'
import { companySlugMatches } from './jobLink'

export type PendingJob = {
  shareableCode: string
  companySlug: string
  jobId: string
  title: string
  company: string
  role: string
  level: string
  jd: string
  primarySkills?: string[]
}

const PENDING_KEY = 'hireright.pendingJob'

export const INVITE_ERROR_KEY = 'hireright.jobInviteError'

export function setPendingJob(job: VendorJob | PendingJob, companySlug: string) {
  const pending: PendingJob = {
    shareableCode: job.shareableCode,
    companySlug,
    jobId: 'id' in job ? job.id : job.jobId,
    title: job.title,
    company: job.company,
    role: ('jobId' in job ? job.role : job.roleTrack) || job.title,
    level: 'jobId' in job ? job.level : job.experienceLevel || '',
    jd: 'jobId' in job ? job.jd : job.jobDescription || '',
    primarySkills: 'jobId' in job ? job.primarySkills : job.requiredSkills,
  }
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending))
}

export function getPendingJob(): PendingJob | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY)
    if (!raw) return null
    return JSON.parse(raw) as PendingJob
  } catch {
    return null
  }
}

export function clearPendingJob() {
  sessionStorage.removeItem(PENDING_KEY)
}

/** After onboarding resume is ready: apply, ATS score, and wire interview to this job. */
export async function finalizePendingJobApplication(): Promise<boolean> {
  const pending = getPendingJob()
  if (!pending) return false

  const user = getUser()
  if (!user || user.role === 'employer') return false

  const profile = getProfile()
  const resumeText = profile?.resumeText?.trim() || ''
  if (resumeText.length < 30) throw new Error('Upload your resume before applying for this job.')

  try {
    await ensureApiSession()
    const applied = await applyToPublicJob(
      pending.shareableCode,
      {
        candidateName: user.name,
        candidateEmail: user.email,
        candidatePhone: user.phone || '',
        experienceYears: profile?.totalExperience || '',
        resumeText,
        resumeName: profile?.resumeName || 'Resume.pdf',
      },
      pending.companySlug,
    )

    sessionStorage.setItem(
      'hireright.targetJob',
      JSON.stringify({
        title: pending.title,
        company: pending.company,
        role: pending.role,
        level: pending.level,
        jd: pending.jd,
        jobId: pending.jobId,
        applicationId: applied.applicationId,
        organizationId: applied.organizationId,
        primarySkills: applied.ats.primarySkills || pending.primarySkills,
        atsScore: applied.ats.atsScore,
        jdMatchScore: applied.ats.jdMatchScore,
      }),
    )
    clearPendingJob()
    return true
  } catch (error) {
    throw error instanceof Error ? error : new Error('Could not save your application. Please retry.')
  }
}

export function validateJobForSlug(job: { company: string }, companySlug?: string) {
  return companySlugMatches(job.company, companySlug)
}
