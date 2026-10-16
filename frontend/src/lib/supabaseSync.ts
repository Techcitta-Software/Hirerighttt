import { getSupabase, isSupabaseEnabled } from './supabaseClient'
import type { InterviewResult, SavedProfile } from './store'
import { getProfile, getUser, profileKey } from './store'

/** Pull cloud profile into localStorage (newer wins). */
export async function pullProfileFromSupabase(): Promise<SavedProfile | null> {
  if (!isSupabaseEnabled()) return getProfile()
  const sb = getSupabase()
  const user = getUser()
  if (!sb || !user?.email) return getProfile()

  const { data: auth } = await sb.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return getProfile()

  const { data, error } = await sb.from('profiles').select('data, updated_at, full_name').eq('id', uid).maybeSingle()
  if (error || !data?.data) return getProfile()

  const remote = data.data as SavedProfile
  const local = getProfile()
  const remoteTime = new Date(data.updated_at || remote.updatedAt || 0).getTime()
  const localTime = new Date(local?.updatedAt || 0).getTime()

  if (!local || remoteTime >= localTime) {
    const merged: SavedProfile = {
      ...(local || {}),
      ...remote,
      fullName: remote.fullName || data.full_name || local?.fullName,
      name: remote.name || data.full_name || local?.name,
      updatedAt: data.updated_at || remote.updatedAt || new Date().toISOString(),
      resumeName: remote.resumeName ?? local?.resumeName ?? null,
    }
    localStorage.setItem(profileKey(user.email), JSON.stringify(merged))
    return merged
  }
  return local
}

/** Upsert profile JSON to Supabase (RLS: own row only). */
export async function syncProfileToSupabase(profile: SavedProfile | null): Promise<void> {
  if (!isSupabaseEnabled() || !profile) return
  const sb = getSupabase()
  const user = getUser()
  if (!sb || !user?.email) return

  const { data: auth } = await sb.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return

  const payload = {
    id: uid,
    email: user.email.toLowerCase(),
    full_name: profile.fullName || profile.name || user.name,
    role: user.role || 'jobseeker',
    company_name: user.companyName || null,
    data: profile,
    updated_at: new Date().toISOString(),
  }

  await sb.from('profiles').upsert(payload, { onConflict: 'id' })
}

export async function syncInterviewResultToSupabase(result: InterviewResult): Promise<void> {
  if (!isSupabaseEnabled()) return
  const sb = getSupabase()
  const user = getUser()
  if (!sb || !user?.email) return

  const { data: auth } = await sb.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return

  await sb.from('interview_results').insert({
    user_id: uid,
    email: user.email.toLowerCase(),
    overall: result.overall,
    data: result,
  })
}

/** Subscribe to auth changes — refresh API token + pull profile. */
export function initSupabaseAuthSync() {
  if (!isSupabaseEnabled()) return () => {}
  const sb = getSupabase()
  if (!sb) return () => {}

  const { data: sub } = sb.auth.onAuthStateChange(async (event, session) => {
    if (session?.access_token) {
      const { setApiToken } = await import('./api')
      setApiToken(session.access_token)
    }
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      const { applySupabaseSession } = await import('./supabaseAuth')
      applySupabaseSession(session, session?.user ?? null)
      await pullProfileFromSupabase()
    }
    if (event === 'SIGNED_OUT') {
      const { setApiToken } = await import('./api')
      setApiToken(null)
    }
  })

  return () => sub.subscription.unsubscribe()
}
