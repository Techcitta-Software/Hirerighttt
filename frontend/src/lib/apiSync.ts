import { apiMe, apiSaveInterview } from './api'
import type { InterviewResult, SavedProfile, User } from './store'
import {
  clearEmployerPortalCache,
  getProfile,
  getUser,
  persistLoggedInUser,
  profileKey,
} from './store'
import { ensureApiSession } from './apiSession'
import { requireApiForAuth } from './authConfig'
import { stripProctoringForCandidateView } from './candidateInterviewResult'

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

/** Align local session with Neon user (role, id) — production SaaS source of truth. */
export async function syncSessionFromApi(): Promise<User | null> {
  const local = getUser()
  if (!local && !requireApiForAuth()) return null
  const ok = await ensureApiSession()
  if (!ok) return local
  try {
    const data = await apiMe()
    const u = data.user as {
      id?: string
      name?: string
      email?: string
      role?: string
      companyName?: string
      phone?: string
      primaryOrganizationId?: string
    }
    if (!u?.email) return local
    const role = u.role === 'employer' ? 'employer' : 'jobseeker'
    if (
      local?.role === 'employer' &&
      u.primaryOrganizationId &&
      local.primaryOrganizationId &&
      local.primaryOrganizationId !== u.primaryOrganizationId
    ) {
      clearEmployerPortalCache()
    }
    return persistLoggedInUser({
      id: u.id || u.email,
      name: u.name || local?.name || u.email.split('@')[0],
      email: u.email,
      role,
      companyName: u.companyName || local?.companyName,
      phone: u.phone || local?.phone,
      primaryOrganizationId: u.primaryOrganizationId || local?.primaryOrganizationId,
    })
  } catch {
    return local
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

/** Merge latest interview report from Neon/API into localStorage (for apply + dashboard). */
export async function pullInterviewFromApi(): Promise<InterviewResult | null> {
  const ok = await ensureApiSession()
  if (!ok) {
    const { getInterviewResult } = await import('./store')
    return getInterviewResult()
  }
  try {
    const data = await apiMe()
    const remote = data.interview as InterviewResult | null | undefined
    const { getInterviewResult, getUser, normalizeInterviewResult, saveInterviewResult } =
      await import('./store')
    const user = getUser()
    if (!user?.email || !remote) return getInterviewResult()

    const local = getInterviewResult()
    const remoteTime = Date.parse(remote.date || '')
    const localTime = local?.date ? Date.parse(local.date) : 0
    if (!local || (Number.isFinite(remoteTime) && remoteTime >= localTime)) {
      const merged = stripProctoringForCandidateView(normalizeInterviewResult(remote))
      saveInterviewResult(merged)
      return merged
    }
    return local
  } catch {
    const { getInterviewResult } = await import('./store')
    return getInterviewResult()
  }
}
