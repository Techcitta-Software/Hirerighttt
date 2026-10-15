import { apiMe, apiSaveInterview } from './api'
import type { InterviewResult, SavedProfile } from './store'
import { getProfile, getUser, profileKey } from './store'
import { ensureApiSession } from './apiSession'

/** Pull server profile into localStorage when cloud copy is newer. */
export async function pullProfileFromApi(): Promise<SavedProfile | null> {
  const ok = await ensureApiSession()
  if (!ok) return getProfile()

  try {
    const data = await apiMe()
    const remote = data.profile as SavedProfile | null | undefined
    if (!remote) return getProfile()

    const user = getUser()
    if (!user?.email) return getProfile()

    const local = getProfile()
    const remoteTime = new Date(remote.updatedAt || 0).getTime()
    const localTime = new Date(local?.updatedAt || 0).getTime()

    if (!local || remoteTime >= localTime) {
      const merged: SavedProfile = {
        ...(local || {}),
        ...remote,
        updatedAt: remote.updatedAt || new Date().toISOString(),
        resumeName: remote.resumeName ?? local?.resumeName ?? null,
      }
      localStorage.setItem(profileKey(user.email), JSON.stringify(merged))
      return merged
    }
    return local
  } catch {
    return getProfile()
  }
}

export async function syncInterviewResultToApi(result: InterviewResult): Promise<void> {
  const ok = await ensureApiSession()
  if (!ok) return
  try {
    await apiSaveInterview(result)
  } catch {
    // offline — local result still kept
  }
}
