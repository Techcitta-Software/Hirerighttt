/**
 * Keeps the Node API Bearer token in sync with the local HireRight session
 * so interview agent routes always run authenticated (Neon-backed API).
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
import { getUser, isLoggedIn, type SavedProfile } from './store'

let syncInFlight: Promise<boolean> | null = null

async function validateToken(): Promise<boolean> {
  if (!getApiToken()) return false
  try {
    await apiMe()
    return true
  } catch {
    setApiToken(null)
    return false
  }
}

/**
 * Ensures a valid API Bearer token exists for the current browser session.
 */
export async function ensureApiSession(): Promise<boolean> {
  if (syncInFlight) return syncInFlight

  syncInFlight = (async () => {
    if (await validateToken()) return true

    const healthy = await apiHealth()
    if (!healthy) return false

    const user = isLoggedIn() ? getUser() : null
    const email = user?.email?.trim().toLowerCase()
    const password = user?.password

    if (email && password) {
      try {
        await apiLogin(email, password)
        return true
      } catch {
        // fall through to demo bootstrap
      }
    }

    if (!email || email === DEMO_CANDIDATE.email) {
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

/** Push latest profile to Neon via the API for the logged-in user. */
export async function syncProfileToApi(profile: SavedProfile | null): Promise<void> {
  if (!profile) return
  const ok = await ensureApiSession()
  if (!ok) return
  try {
    await apiSaveProfile(profile)
  } catch {
    // offline — local profile still saved
  }
}
