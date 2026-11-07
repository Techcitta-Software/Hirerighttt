import { initialFormData } from '../data/wizard'
import { apiHealth, apiSaveProfile } from './api'
import { getProfile, getUser, saveProfile } from './store'

/**
 * New jobseekers have no machine-readable profile yet — seed step 0 before onboarding.
 */
/** Seeds an empty local profile for a brand-new job seeker. Returns true when it created one. */
export function ensureNewJobseekerProfileSeed(): boolean {
  const user = getUser()
  if (!user || user.role === 'employer') return false
  const existing = getProfile()
  if (existing != null && typeof existing.completedSteps === 'number') return false

  saveProfile(
    {
      ...initialFormData,
      resumeFile: null,
      resumeText: '',
      resumeName: null,
    },
    0,
  )
  return true
}

export async function ensureNewJobseekerProfileOnServer(): Promise<void> {
  // Only a profile created just now needs uploading. Re-saving an existing profile on every
  // login cost ~5s (the server re-indexes the candidate) and changed nothing.
  if (!ensureNewJobseekerProfileSeed()) return
  const profile = getProfile()
  if (!profile) return
  try {
    if (await apiHealth()) await apiSaveProfile(profile)
  } catch {
    /* local seed is enough offline */
  }
}
