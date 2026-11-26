const TARGET_JOB_KEY = 'hireright.targetJob'
/**
 * Copy that survives closing the tab (sessionStorage is per tab): without it, reopening /interview silently turned a
 * job interview into a generic career interview (T5 B10). Bound to the signed-in account and expires.
 */
export const TARGET_JOB_BACKUP_KEY = 'hireright.targetJob.backup'
export const TARGET_JOB_TTL_MS = 24 * 60 * 60 * 1000

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

function currentAccountEmail(): string {
  try {
    // lib/store keeps the signed-in email under this key (read directly so this module stays dependency-free).
    return String(localStorage.getItem('hireright.session') || '').toLowerCase()
  } catch {
    return ''
  }
}

function normalize(raw: TargetJob & { applicantId?: string }): TargetJob {
  return { ...raw, applicationId: raw.applicationId || raw.applicantId }
}

function readBackup(now = Date.now()): TargetJob | null {
  try {
    const str = localStorage.getItem(TARGET_JOB_BACKUP_KEY)
    if (!str) return null
    const parsed = JSON.parse(str) as { savedAt?: number; email?: string; job?: TargetJob }
    const expired = !parsed.savedAt || now - parsed.savedAt > TARGET_JOB_TTL_MS
    const otherAccount = Boolean(parsed.email) && parsed.email !== currentAccountEmail()
    if (!parsed.job || expired || otherAccount) {
      localStorage.removeItem(TARGET_JOB_BACKUP_KEY)
      return null
    }
    return normalize(parsed.job)
  } catch {
    return null
  }
}

export function readTargetJob(): TargetJob | null {
  if (typeof sessionStorage === 'undefined') return null
  let str: string | null = null
  try {
    str = sessionStorage.getItem(TARGET_JOB_KEY)
  } catch {
    str = null
  }
  if (!str) {
    const backup = typeof localStorage === 'undefined' ? null : readBackup()
    if (backup) {
      try {
        sessionStorage.setItem(TARGET_JOB_KEY, JSON.stringify(backup))
      } catch {
        /* ignore */
      }
    }
    return backup
  }
  try {
    return normalize(JSON.parse(str) as TargetJob & { applicantId?: string })
  } catch {
    return null
  }
}

export function writeTargetJob(job: TargetJob): void {
  try {
    sessionStorage.setItem(TARGET_JOB_KEY, JSON.stringify(job))
  } catch {
    /* storage unavailable */
  }
  try {
    localStorage.setItem(
      TARGET_JOB_BACKUP_KEY,
      JSON.stringify({ savedAt: Date.now(), email: currentAccountEmail(), job }),
    )
  } catch {
    /* private mode */
  }
}

export function clearTargetJob(): void {
  try {
    sessionStorage.removeItem(TARGET_JOB_KEY)
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(TARGET_JOB_BACKUP_KEY)
  } catch {
    /* ignore */
  }
}
