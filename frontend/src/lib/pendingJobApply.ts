import { getProfile, getUser } from './store'
import { resolveCandidateNameFrom } from './candidateName'
import { applyToPublicJob, type VendorJob } from './vendorApi'
import { ensureApiSession } from './apiSession'
import { companySlugMatches } from './jobLink'
import { clearTargetJob, readTargetJob, writeTargetJob, type TargetJob } from './targetJob'

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
/** Backup copy that survives a new tab / window during sign-up or log-in (sessionStorage is per tab). */
const PENDING_BACKUP_KEY = 'hireright.pendingJob.backup'
/** A job link opened more than this long ago is no longer carried into a new session. */
export const PENDING_JOB_TTL_MS = 12 * 60 * 60 * 1000

export const INVITE_ERROR_KEY = 'hireright.jobInviteError'

function writePending(pending: PendingJob) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending))
  } catch {
    /* storage unavailable */
  }
  try {
    localStorage.setItem(PENDING_BACKUP_KEY, JSON.stringify({ savedAt: Date.now(), job: pending }))
  } catch {
    /* storage unavailable (private mode) */
  }
}

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
  // The newest job link is the candidate's current intent: an older job's interview context must not win over it.
  const existing = readTargetJob()
  if (existing && existing.jobId !== pending.jobId) clearTargetJob()
  writePending(pending)
}

export function getPendingJob(): PendingJob | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY)
    if (raw) return JSON.parse(raw) as PendingJob
  } catch {
    /* fall through to the backup */
  }
  // Signed up / logged in from another tab: restore the job from the backup (if it is recent).
  try {
    const backup = localStorage.getItem(PENDING_BACKUP_KEY)
    if (!backup) return null
    const parsed = JSON.parse(backup) as { savedAt?: number; job?: PendingJob }
    if (!parsed.job?.jobId || !parsed.savedAt || Date.now() - parsed.savedAt > PENDING_JOB_TTL_MS) {
      localStorage.removeItem(PENDING_BACKUP_KEY)
      return null
    }
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(parsed.job))
    } catch {
      /* ignore */
    }
    return parsed.job
  } catch {
    return null
  }
}

export function clearPendingJob() {
  try {
    sessionStorage.removeItem(PENDING_KEY)
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(PENDING_BACKUP_KEY)
  } catch {
    /* ignore */
  }
}

/** The pending job link in the shape the interview room reads (title, role, level and the JD). */
export function pendingJobAsTargetJob(pending: PendingJob): TargetJob {
  return {
    title: pending.title,
    company: pending.company,
    role: pending.role,
    level: pending.level,
    jd: pending.jd,
    jobId: pending.jobId,
    primarySkills: pending.primarySkills,
  }
}

/**
 * Which job (if any) the interview is for. A job link that has not been applied to yet (the candidate came through
 * sign-up / log-in) wins, so its JD is preloaded instead of a generic resume interview; otherwise the job set by the
 * apply page or an emailed invite.
 */
export function resolveInterviewJobContext(): TargetJob | null {
  const pending = getPendingJob()
  if (pending) return pendingJobAsTargetJob(pending)
  return readTargetJob()
}

/**
 * Called when the interview starts. If the candidate arrived from a job link that has not been applied to yet, apply
 * now so the session is linked to the application on the server (recruiter sees it; job interviews are free). If the
 * application cannot be saved, the interview still uses the job (jobId + JD), never a generic one.
 */
export async function ensureJobLinkApplication(): Promise<TargetJob | null> {
  const pending = getPendingJob()
  if (!pending) return readTargetJob()
  try {
    if (await finalizePendingJobApplication()) return readTargetJob() ?? pendingJobAsTargetJob(pending)
  } catch {
    /* fall through: interview for the job without an application id */
  }
  return pendingJobAsTargetJob(pending)
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
        candidateName: resolveCandidateNameFrom(profile, user),  // the name on the resume
        candidateEmail: user.email,
        candidatePhone: user.phone || '',
        experienceYears: profile?.totalExperience || '',
        resumeText,
        resumeName: profile?.resumeName || 'Resume.pdf',
        source: 'shared_link',
      },
      pending.companySlug,
    )

    writeTargetJob({
      title: pending.title,
      company: pending.company,
      role: pending.role,
      level: pending.level,
      jd: pending.jd,
      jobId: applied.job?.id || pending.jobId,
      applicationId: applied.applicationId,
      organizationId: applied.organizationId,
      primarySkills: applied.ats.primarySkills || pending.primarySkills,
      atsScore: applied.ats.atsScore,
      jdMatchScore: applied.ats.jdMatchScore,
    })
    clearPendingJob()
    return true
  } catch (error) {
    throw error instanceof Error ? error : new Error('Could not save your application. Please retry.')
  }
}

export function validateJobForSlug(job: { company: string }, companySlug?: string) {
  return companySlugMatches(job.company, companySlug)
}
