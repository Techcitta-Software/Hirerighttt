/**
 * Candidate job board (/jobs): search, location / work-mode filters and the per-candidate "Saved" and
 * "Not for me" lists. Pure helpers so the page and its tests share one implementation.
 */

export type JobBoardItem = {
  id: string
  title: string
  company: string
  location: string
  /** 'Remote' when the posting says so; '' when the employer did not state a work mode. */
  mode: string
  skillTags: string[]
}

export type JobBoardFilters = {
  search: string
  location: string
  mode: string
}

export const ANY = 'Any'

export function isRemoteJob(job: Pick<JobBoardItem, 'location' | 'mode'>): boolean {
  return /remote/i.test(job.mode) || /remote/i.test(job.location)
}

/** Work mode shown on a card: only what the posting states (never an invented "Hybrid"). */
export function jobWorkMode(location: string | undefined): string {
  return /remote/i.test(location || '') ? 'Remote' : ''
}

/** Location filter options built from the open roles (plus Remote and Any), so every role can be filtered to. */
export function jobLocationOptions(jobs: Array<Pick<JobBoardItem, 'location'>>): string[] {
  const seen = new Map<string, string>()
  for (const job of jobs) {
    for (const part of (job.location || '').split(/[,/|]/)) {
      const name = part.trim()
      if (!name || /remote/i.test(name)) continue
      const key = name.toLowerCase()
      if (!seen.has(key)) seen.set(key, name)
    }
  }
  return [...[...seen.values()].sort((a, b) => a.localeCompare(b)), 'Remote']
}

/**
 * Applies the visible filters to the list, in both the "For you" and "All jobs" scopes. There is no hidden filter:
 * which roles are "for you" is decided by the server (scope=matched).
 */
export function filterJobBoard<T extends JobBoardItem>(jobs: T[], filters: JobBoardFilters, hiddenIds?: Set<string>): T[] {
  const term = filters.search.trim().toLowerCase()
  return jobs.filter((job) => {
    if (hiddenIds?.has(job.id)) return false
    if (
      term &&
      !job.title.toLowerCase().includes(term) &&
      !job.company.toLowerCase().includes(term) &&
      !job.skillTags.some((s) => s.toLowerCase().includes(term))
    ) {
      return false
    }
    if (filters.location && filters.location !== ANY) {
      if (filters.location.toLowerCase() === 'remote') {
        if (!isRemoteJob(job)) return false
      } else if (!job.location.toLowerCase().includes(filters.location.toLowerCase()) && !isRemoteJob(job)) {
        return false
      }
    }
    if (filters.mode && filters.mode !== ANY) {
      if (filters.mode.toLowerCase() === 'remote' && !isRemoteJob(job)) return false
    }
    return true
  })
}

export function hasActiveJobFilters(filters: JobBoardFilters): boolean {
  return Boolean(filters.search.trim()) || (filters.location || ANY) !== ANY || (filters.mode || ANY) !== ANY
}

const SAVED_KEY = 'hireright.savedJobs'
const HIDDEN_KEY = 'hireright.hiddenJobs'

function readIds(key: string, email: string | undefined): Set<string> {
  if (!email) return new Set()
  try {
    const raw = localStorage.getItem(`${key}.${email}`)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeIds(key: string, email: string | undefined, ids: Set<string>) {
  if (!email) return
  try {
    localStorage.setItem(`${key}.${email}`, JSON.stringify([...ids]))
  } catch {
    /* storage unavailable: the list just lasts for this visit */
  }
}

export const readSavedJobIds = (email?: string) => readIds(SAVED_KEY, email)
export const writeSavedJobIds = (email: string | undefined, ids: Set<string>) => writeIds(SAVED_KEY, email, ids)
export const readHiddenJobIds = (email?: string) => readIds(HIDDEN_KEY, email)
export const writeHiddenJobIds = (email: string | undefined, ids: Set<string>) => writeIds(HIDDEN_KEY, email, ids)
