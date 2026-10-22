/**
 * Auth session helpers (local session + API Bearer token verified via /api/me).
 */
import type { NavigateFunction } from 'react-router-dom'
import { apiMe, getApiToken, setApiToken } from './api'
import { isOnboardingComplete, onboardingResumeStep } from './onboardingProgress'
import { getProfile, getUser, logout, type User } from './store'

export const AUTH_INVALID_MSG_KEY = 'hireright.authInvalidMessage'
export const OPEN_AUTH_INVALID_EVENT = 'hireright-auth-invalid'

export function setAuthInvalidMessage(message: string) {
  sessionStorage.setItem(AUTH_INVALID_MSG_KEY, message)
  window.dispatchEvent(new CustomEvent(OPEN_AUTH_INVALID_EVENT, { detail: { message } }))
}

export function consumeAuthInvalidMessage(): string | null {
  const msg = sessionStorage.getItem(AUTH_INVALID_MSG_KEY)
  if (msg) sessionStorage.removeItem(AUTH_INVALID_MSG_KEY)
  return msg
}

const SESSION_VALID_CACHE_MS = 45_000
let sessionValidCache: { email: string; ok: boolean; at: number } | null = null

export function clearSessionValidationCache() {
  sessionValidCache = null
}

export function clearStoredAuth() {
  setApiToken(null)
  logout()
  clearSessionValidationCache()
}

export function hasLocalSession(): boolean {
  return Boolean(getUser())
}

/** True when Bearer token is valid and matches the locally stored user email. */
export async function isApiSessionValid(): Promise<boolean> {
  const user = getUser()
  if (!user?.email?.trim()) return false
  if (!getApiToken()) return false
  const expected = user.email.trim().toLowerCase()
  const now = Date.now()
  if (
    sessionValidCache &&
    sessionValidCache.email === expected &&
    sessionValidCache.ok &&
    now - sessionValidCache.at < SESSION_VALID_CACHE_MS
  ) {
    return true
  }
  try {
    const me = (await apiMe()) as { user?: { email?: string } }
    const tokenEmail = me.user?.email?.trim().toLowerCase()
    if (!tokenEmail || tokenEmail !== expected) {
      setApiToken(null)
      sessionValidCache = { email: expected, ok: false, at: now }
      return false
    }
    sessionValidCache = { email: expected, ok: true, at: now }
    return true
  } catch {
    setApiToken(null)
    sessionValidCache = { email: expected, ok: false, at: now }
    return false
  }
}

/** Post-login route (mirrors AuthPages.navigateAfterLogin rules). */
export function resolveAuthenticatedDestination(
  user: User,
  fromPath?: string | null,
  forcedPath?: string,
): string {
  if (forcedPath) return forcedPath

  const isUploadIntent =
    typeof sessionStorage !== 'undefined' &&
    sessionStorage.getItem('hireright.intent') === 'upload_resume'
  if (isUploadIntent) {
    sessionStorage.removeItem('hireright.intent')
    if (user.role === 'employer') return '/employer/dashboard'
    const profile = getProfile()
    if (isOnboardingComplete(profile)) return '/profile'
    return `/onboarding?step=${onboardingResumeStep(profile)}`
  }

  if (user.role === 'employer') return '/employer/dashboard'

  const profile = getProfile()
  if (!isOnboardingComplete(profile)) {
    return `/onboarding?step=${onboardingResumeStep(profile)}`
  }

  // Returning jobseekers: workspace home (not interview room or one-time report view).
  const interviewEntry =
    fromPath === '/interview' ||
    fromPath === '/interview/now' ||
    (fromPath?.startsWith('/interview/') && !fromPath.startsWith('/interview/invite'))
  const oneTimeReport = fromPath === '/dashboard/report'
  if (
    fromPath &&
    fromPath !== '/login' &&
    fromPath !== '/signup' &&
    fromPath !== '/onboarding' &&
    !interviewEntry &&
    !oneTimeReport
  ) {
    return fromPath
  }
  return '/dashboard'
}

/** If already logged in with a valid API session, return redirect path; else null. */
export async function tryRedirectIfAlreadyAuthenticated(
  fromPath?: string | null,
): Promise<string | null> {
  if (!hasLocalSession()) return null
  if (!(await isApiSessionValid())) return null
  const user = getUser()
  if (!user) return null
  return resolveAuthenticatedDestination(user, fromPath)
}

const INVALID_AUTH_MSG =
  'Your saved sign-in could not be verified with the server. Please log in again.'

/**
 * Home / nav “Log in”: validate stored session with backend, then dashboard or login.
 */
export async function handleLoginNavigation(navigate: NavigateFunction): Promise<void> {
  const user = getUser()
  const token = getApiToken()

  if (!user && !token) {
    navigate('/login')
    return
  }

  if ((user && !token) || (!user && token)) {
    clearStoredAuth()
    setAuthInvalidMessage('Stored auth data is not valid. Please sign in again.')
    navigate('/login', { replace: true })
    return
  }

  const valid = await isApiSessionValid()
  if (!valid) {
    clearStoredAuth()
    setAuthInvalidMessage(INVALID_AUTH_MSG)
    navigate('/login', { replace: true })
    return
  }

  const current = getUser()
  if (!current) {
    navigate('/login')
    return
  }
  navigate(resolveAuthenticatedDestination(current), { replace: true })
}

/** Login/signup mount: redirect if valid; clear and flag message if stale local auth. */
export async function reconcileAuthOnAuthPage(): Promise<
  | { action: 'redirect'; path: string }
  | { action: 'invalid'; message: string }
  | { action: 'none' }
> {
  const user = getUser()
  const token = getApiToken()

  if (!user && !token) return { action: 'none' }

  if ((user && !token) || (!user && token)) {
    clearStoredAuth()
    return {
      action: 'invalid',
      message: 'Stored auth data is not valid. Please sign in again.',
    }
  }

  const valid = await isApiSessionValid()
  if (!valid) {
    clearStoredAuth()
    return { action: 'invalid', message: INVALID_AUTH_MSG }
  }

  const current = getUser()
  if (!current) return { action: 'none' }
  return { action: 'redirect', path: resolveAuthenticatedDestination(current) }
}
