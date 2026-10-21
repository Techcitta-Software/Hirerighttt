import { initialFormData } from '../data/wizard'
import { apiHealth, apiSaveProfile } from './api'
import { getProfile, getUser, saveProfile } from './store'

/**
 * New jobseekers have no machine-readable profile yet — seed step 0 before onboarding.
 */
export function ensureNewJobseekerProfileSeed(): void {
  const user = getUser()
  if (!user || user.role === 'employer') return
  const existing = getProfile()
  if (existing != null && typeof existing.completedSteps === 'number') return

  saveProfile(
    {
      ...initialFormData,
      resumeFile: null,
      resumeText: '',
      resumeName: null,
    },
    0,
  )
}

export async function ensureNewJobseekerProfileOnServer(): Promise<void> {
  ensureNewJobseekerProfileSeed()
  const profile = getProfile()
  if (!profile) return
  try {
    if (await apiHealth()) await apiSaveProfile(profile)
  } catch {
    /* local seed is enough offline */
  }
}
