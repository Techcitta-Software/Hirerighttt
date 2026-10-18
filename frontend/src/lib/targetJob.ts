const TARGET_JOB_KEY = 'hireright.targetJob'

export type TargetJob = {
  jobId?: string
  applicationId?: string
  organizationId?: string
  title: string
  company: string
  role: string
  level: string
  jd?: string
  primarySkills?: string[]
  atsScore?: number
  jdMatchScore?: number
}

export function readTargetJob(): TargetJob | null {
  if (typeof sessionStorage === 'undefined') return null
  const str = sessionStorage.getItem(TARGET_JOB_KEY)
  if (!str) return null
  try {
    const raw = JSON.parse(str) as TargetJob & { applicantId?: string }
    const applicationId = raw.applicationId || raw.applicantId
    return {
      ...raw,
      applicationId,
    }
  } catch {
    return null
  }
}

export function writeTargetJob(job: TargetJob): void {
  sessionStorage.setItem(TARGET_JOB_KEY, JSON.stringify(job))
}

export function clearTargetJob(): void {
  sessionStorage.removeItem(TARGET_JOB_KEY)
}
