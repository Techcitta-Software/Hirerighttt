/**
 * Keeps the Node API Bearer token in sync with the local HireRight session
 * (including Candidate Demo) so interview agent routes always run authenticated.
 */
import {
  DEMO_CANDIDATE,
  apiHealth,
  apiLogin,
  apiMe,
  apiSaveProfile,
  apiSignup,
  getApiToken,
  setApiToken,
} from './api'
import { isSupabaseEnabled } from './supabaseClient'
import { refreshSupabaseApiToken } from './supabaseAuth'
import { syncProfileToSupabase } from './supabaseSync'
import { getUser, isLoggedIn, type SavedProfile } from './store'

let syncInFlight: Promise<boolean> | null = null
let tokenValidCache: { email: string; ok: boolean; at: number } | null = null
const TOKEN_VALID_CACHE_MS = 45_000

async function validateToken(expectedEmail?: string): Promise<boolean> {
  if (!getApiToken()) return false
  const key = (expectedEmail || '').toLowerCase()
  const now = Date.now()
  if (
    tokenValidCache &&
    tokenValidCache.email === key &&
    tokenValidCache.ok &&
    now - tokenValidCache.at < TOKEN_VALID_CACHE_MS
  ) {
    return true
  }
  try {
    const me = (await apiMe()) as { user?: { email?: string } }
    const tokenEmail = me.user?.email?.trim().toLowerCase()
    if (expectedEmail && tokenEmail !== expectedEmail) {
      setApiToken(null)
      tokenValidCache = { email: key, ok: false, at: now }
      return false
    }
    tokenValidCache = { email: key, ok: true, at: now }
    return true
  } catch {
    setApiToken(null)
    tokenValidCache = { email: key, ok: false, at: now }
    return false
  }
}

/**
 * Ensures a valid API Bearer token exists for the current browser session.
 * Works for demo@hireright.com and any locally stored user with password.
 */
export async function ensureApiSession(): Promise<boolean> {
  if (syncInFlight) return syncInFlight

  syncInFlight = (async () => {
    if (isSupabaseEnabled()) {
      void refreshSupabaseApiToken()
    }

    const user = isLoggedIn() ? getUser() : null
    const email = user?.email?.trim().toLowerCase()
    const password = user?.password

    if (await validateToken(isSupabaseEnabled() ? undefined : email)) return true

    const healthy = await apiHealth()
    if (!healthy) return false

    if (email && password) {
      try {
        await apiLogin(email, password)
        return true
      } catch {
        // account may exist only in this browser — register it on the API
      }
      if (user?.name && user.phone) {
        try {
          await apiSignup(user.name, email, password, {
            role: user.role ?? 'jobseeker',
            companyName: user.companyName,
            phone: user.phone,
          })
          return true
        } catch {
          // fall through to demo bootstrap
        }
      }
    }

    if (!isSupabaseEnabled() && (!email || email === DEMO_CANDIDATE.email)) {
      try {
        await apiLogin(DEMO_CANDIDATE.email, DEMO_CANDIDATE.password)
        return true
      } catch {
        return false
      }
    }

    return false
  })()

  try {
    return await syncInFlight
  } finally {
    syncInFlight = null
  }
}

/** Push latest profile (resume, name, skills) to the API for the logged-in user. */
export async function syncProfileToApi(profile: SavedProfile | null): Promise<void> {
  if (!profile) return
  void syncProfileToSupabase(profile)
  const ok = await ensureApiSession()
  if (!ok) return
  try {
    await apiSaveProfile(profile)
  } catch {
    // offline / API error — local + Supabase profile may still be saved
  }
}
