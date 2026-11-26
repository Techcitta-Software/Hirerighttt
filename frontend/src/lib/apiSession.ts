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
  getApiToken,
  setApiToken,
} from './api'
import { demoAccountForEmail } from './authDemo'
import { isNetworkFailure } from './networkFailure'
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
  } catch (err) {
    // No answer at all (offline, timeout, or the request aborted because the page is navigating away) says nothing
    // about the token: keep it. Clearing it here signed people out when they clicked through pages quickly.
    if (isNetworkFailure(err)) return false
    setApiToken(null)
    tokenValidCache = { email: key, ok: false, at: now }
    return false
  }
}

/**
 * Ensures a valid API Bearer token exists for the current browser session.
 * Relies on the stored API token / cookie session only: passwords are never kept in the browser, so an expired
 * session means signing in again (the built-in demo candidate is the one exception).
 */
export async function ensureApiSession(): Promise<boolean> {
  if (syncInFlight) return syncInFlight

  syncInFlight = (async () => {
    if (isSupabaseEnabled()) {
      void refreshSupabaseApiToken()
    }

    const user = isLoggedIn() ? getUser() : null
    const email = user?.email?.trim().toLowerCase()

    if (await validateToken(isSupabaseEnabled() ? undefined : email)) return true

    const healthy = await apiHealth()
    if (!healthy) return false

    // Built-in demo accounts: their (public, hard-coded) credentials live in code, never in storage.
    const demo = email ? demoAccountForEmail(email) : undefined
    if (!isSupabaseEnabled() && demo && demo.email !== DEMO_CANDIDATE.email) {
      try {
        await apiLogin(demo.email, demo.password)
        return true
      } catch {
        return false
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
