/** Thin client for the optional Node API. Falls back silently when offline. */
const ENV_API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
/** When Vite proxy is down, dev builds may talk to the API directly (CORS must allow the page origin). */
const DEV_API_FALLBACK = (
  import.meta.env.VITE_DEV_API_FALLBACK || 'http://127.0.0.1:8787'
).replace(/\/$/, '')

import { decideColdStartRetry, setColdStartBanner } from './coldStart'
import { trackRequest } from './loadingTracker'
import { isNetworkFailure } from './networkFailure'
import { cachedRequest, clearRequestCache } from './requestCache'

let runtimeApiBase = ENV_API_BASE
let resolveApiBasePromise: Promise<string> | null = null

const TOKEN_KEY = 'hireright.apiToken'

export const API_OFFLINE_HINT =
  'Cannot reach the API. From the project folder run: npm run dev:all (Vite :5173 + API :8787), then reload this page.'

export function apiConnectionHint(): string {
  if (import.meta.env.DEV) return API_OFFLINE_HINT
  if (ENV_API_BASE) {
    return `Cannot reach the API at ${ENV_API_BASE}. Check VITE_API_URL and that the backend is running.`
  }
  return 'Cannot reach the server. Check your connection and try again.'
}

const HEALTH_PING_MS = import.meta.env.DEV ? 2_500 : 8_000
let healthCache: { at: number; ok: boolean } | null = null
const HEALTH_CACHE_MS = 20_000

async function pingHealth(base: string): Promise<boolean> {
  const root = base.replace(/\/$/, '')
  const url = root ? `${root}/api/health` : '/api/health'
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(HEALTH_PING_MS) })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean }
    return Boolean(res.ok && data.ok)
  } catch {
    return false
  }
}

/** Picks same-origin /api (Vite proxy) or direct :8787 in local dev. */
export async function resolveApiBase(): Promise<string> {
  if (ENV_API_BASE) {
    runtimeApiBase = ENV_API_BASE
    return runtimeApiBase
  }
  if (runtimeApiBase) return runtimeApiBase
  // Production builds are served from the same origin as /api: no need to probe for a fallback
  // (the probe cost a full round trip before the first real request on every page load).
  if (!import.meta.env.DEV) return runtimeApiBase
  if (resolveApiBasePromise) return resolveApiBasePromise
  resolveApiBasePromise = (async () => {
    if (await pingHealth('')) {
      runtimeApiBase = ''
      healthCache = { at: Date.now(), ok: true }
      return runtimeApiBase
    }
    if (import.meta.env.DEV && (await pingHealth(DEV_API_FALLBACK))) {
      runtimeApiBase = DEV_API_FALLBACK
      return runtimeApiBase
    }
    runtimeApiBase = ''
    return runtimeApiBase
  })()
  return resolveApiBasePromise
}

/** Re-export for API callers; canonical definitions live in authDemo.ts */
export { DEMO_CANDIDATE } from './authDemo'

export function getApiToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function setApiToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
  invalidateMeCache()
}

/** Same-origin `/api` in Vite dev; absolute URL when `VITE_API_URL` or dev fallback is set. */
export function apiUrl(path: string) {
  const p = path.startsWith('/') ? path : `/${path}`
  const base = runtimeApiBase || ENV_API_BASE
  return base ? `${base}${p}` : p
}

/** `background: true` marks a refresh nobody is waiting on, so it never raises the loading veil. */
export type ApiFetchOptions = RequestInit & { background?: boolean }

/** This tab has already used its one cold-start retry. */
let coldStartRetryUsed = false

export async function apiFetch(path: string, { background = false, ...options }: ApiFetchOptions = {}) {
  await resolveApiBase()
  // Any write can change what /api/me returns (profile, interview, applications).
  if (options.method && options.method.toUpperCase() !== 'GET') invalidateMeCache()
  const settled = background ? () => undefined : trackRequest(path)
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  }
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData
  if (!isForm && !headers['Content-Type']) headers['Content-Type'] = 'application/json'
  const token = getApiToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const send = (signal?: AbortSignal) => {
    const pending = fetch(apiUrl(path), { ...options, headers, signal })
    trackReachability(pending)
    return pending
  }

  // Interview start can take up to ~36s while the server fails over between Gemini keys/models.
  const timeoutMs = 45_000
  const signal =
    options.signal ??
    (typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined)
  try {
    try {
      return await send(signal)
    } catch (err) {
      const decision = decideColdStartRetry({
        healthSucceeded: Boolean(healthCache?.ok),
        alreadyRetriedThisTab: coldStartRetryUsed,
        // A signal the caller already aborted (navigation) is not a cold host.
        isTimeoutOrNetwork: isNetworkFailure(err) && !options.signal?.aborted,
      })
      if (!decision.retry) throw err
      coldStartRetryUsed = true
      setColdStartBanner(decision.banner)
      const retrySignal =
        typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(decision.timeoutMs) : undefined
      const retried = await send(retrySignal)
      setColdStartBanner('')
      return retried
    }
  } finally {
    settled()
  }
}

/** One deep health check after boot. Not awaited, so the first paint is not held for a sleeping server. */
let deepHealthBooted = false
function bootDeepHealthOnce() {
  if (deepHealthBooted || typeof window === 'undefined') return
  if (import.meta.env.MODE === 'test') return
  deepHealthBooted = true
  queueMicrotask(() => {
    void apiFetch('/api/health?deep=1', { background: true }).catch(() => undefined)
  })
}
bootDeepHealthOnce()

/**
 * Any answer from the API (even a 401 or 404) proves it is reachable, so a real request doubles as the
 * health check: apiHealth() reuses it instead of sending its own /api/health ping. A gateway error
 * (502-504) or a network failure says nothing, so those leave the cache alone.
 */
const inflightRequests = new Set<Promise<boolean>>()

function trackReachability(pending: Promise<Response>) {
  const probe = pending.then(
    (res) => {
      const reachable = res.status < 502 || res.status > 504
      if (reachable) healthCache = { at: Date.now(), ok: true }
      return reachable
    },
    () => false,
  )
  inflightRequests.add(probe)
  void probe.finally(() => inflightRequests.delete(probe))
}

function freshHealth(): boolean | null {
  if (healthCache && Date.now() - healthCache.at < HEALTH_CACHE_MS) return healthCache.ok
  return null
}

async function request(path: string, options: ApiFetchOptions = {}) {
  const res = await apiFetch(path, options)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Dispatch routes answer { error }, native FastAPI routes answer { detail }.
    const message = data.error || (typeof data.detail === 'string' ? data.detail : '')
    throw new Error(message || `Request failed (${res.status})`)
  }
  return data
}

/**
 * /api/me is read by several helpers right after login (session sync, profile pull, token check).
 * Share one in-flight request and reuse the answer for a few seconds instead of fetching it 3×.
 */
const ME_CACHE_MS = 4_000
let meInFlight: { token: string | null; promise: Promise<any> } | null = null
let meCache: { token: string | null; at: number; data: any } | null = null

export function invalidateMeCache() {
  meCache = null
  meInFlight = null
  // Shared GET answers (jobs, alerts, mail status) may be stale after a write or an account switch.
  clearRequestCache()
}

export async function apiMe() {
  const token = getApiToken()
  if (meCache && meCache.token === token && Date.now() - meCache.at < ME_CACHE_MS) return meCache.data
  if (meInFlight && meInFlight.token === token) return meInFlight.promise
  const promise = request('/api/me')
    .then((data) => {
      meCache = { token, at: Date.now(), data }
      return data
    })
    .finally(() => {
      if (meInFlight?.promise === promise) meInFlight = null
    })
  meInFlight = { token, promise }
  return promise
}

let healthInFlight: Promise<boolean> | null = null

/** Is the API up? Cached for 20s, and callers that ask at the same moment share one request. */
export function apiHealth(): Promise<boolean> {
  const cached = freshHealth()
  if (cached !== null) return Promise.resolve(cached)
  if (!healthInFlight) {
    healthInFlight = checkApiHealth().finally(() => {
      healthInFlight = null
    })
  }
  return healthInFlight
}

async function checkApiHealth(): Promise<boolean> {
  await resolveApiBase()
  // resolveApiBase() may itself have just pinged /api/health.
  let cached = freshHealth()
  if (cached !== null) return cached
  // A request already on its way answers the question without another ping.
  // (Bounded: a slow request such as interview start must not hold the health answer.)
  if (inflightRequests.size) {
    const probes = [...inflightRequests]
    const reachable = await new Promise<boolean>((resolve) => {
      let left = probes.length
      const timer = setTimeout(() => resolve(false), HEALTH_PING_MS)
      for (const probe of probes) {
        void probe.then((ok) => {
          left -= 1
          if (ok || left === 0) {
            clearTimeout(timer)
            resolve(ok)
          }
        })
      }
    })
    if (reachable) return true
    cached = freshHealth()
    if (cached !== null) return cached
  }
  let ok = false
  if (ENV_API_BASE) {
    try {
      const data = await request('/api/health')
      ok = Boolean(data.ok)
    } catch {
      ok = false
    }
  } else if (await pingHealth(runtimeApiBase)) {
    ok = true
  } else if (import.meta.env.DEV && !runtimeApiBase && (await pingHealth(DEV_API_FALLBACK))) {
    runtimeApiBase = DEV_API_FALLBACK
    resolveApiBasePromise = Promise.resolve(DEV_API_FALLBACK)
    ok = true
  }
  healthCache = { at: Date.now(), ok }
  return ok
}

export async function apiSignup(
  name: string,
  email: string,
  password: string,
  extras?: {
    role?: 'jobseeker' | 'employer'
    companyName?: string
    phone?: string
    /** When false, account is created but no Bearer token is stored (sign-in separately). */
    storeSessionToken?: boolean
  },
) {
  const data = await request('/api/signup', {
    method: 'POST',
    body: JSON.stringify({
      name,
      email,
      password,
      role: extras?.role,
      companyName: extras?.companyName,
      phone: extras?.phone,
    }),
  })
  if (extras?.storeSessionToken !== false) {
    setApiToken(data.token)
  }
  return data.user
}

export type ApiUser = {
  id?: string
  name?: string
  email?: string
  role?: 'employer' | 'jobseeker'
  companyName?: string
  phone?: string
  primaryOrganizationId?: string
}

/** Emails a single-use reset link. The server answers the same way whether or not the account exists. */
export async function apiRequestPasswordReset(email: string): Promise<string> {
  const data = await request('/api/password/forgot', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
  return String(data.message || '')
}

/** Signed-in password change. The server signs out other sessions and returns a new token for this one. */
export async function apiChangePassword(currentPassword: string, newPassword: string): Promise<string> {
  const data = await request('/api/password/change', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  })
  if (typeof data.token === 'string' && data.token) setApiToken(data.token)
  return String(data.message || 'Password updated.')
}

export async function apiResetPassword(token: string, password: string): Promise<string> {
  const data = await request('/api/password/reset', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  })
  return String(data.message || '')
}

export async function apiLogin(
  email: string,
  password: string,
  expectedRole?: 'employer' | 'jobseeker',
) {
  const data = await request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, expectedRole }),
  })
  setApiToken(data.token)
  return data.user as ApiUser
}

/** `background: true` for autosaves nobody waits on (wizard step saves, post-interview sync). */
export async function apiSaveProfile(profile: unknown, opts: { background?: boolean } = {}) {
  return request('/api/profile', {
    method: 'PUT',
    body: JSON.stringify(profile),
    background: opts.background,
  })
}

export async function apiSaveInterview(interview: unknown) {
  return request('/api/interview', {
    method: 'POST',
    body: JSON.stringify(interview),
  })
}

export type ApiApplicationStatus =
  | 'Applied'
  | 'In Review'
  | 'Selected'
  | 'Not selected'
  | 'Interview'
  | 'Offer'

export type ApiApplicationTimelineStep = {
  key: string
  label: string
  done: boolean
  current: boolean
}

export type ApiApplication = {
  id: string
  title: string
  company: string
  location: string
  match: number
  status: ApiApplicationStatus
  /** Employer-side status, when the API includes it. */
  employerStatus?: 'applied' | 'interviewed' | 'shortlisted' | 'rejected'
  /** Progress steps. Missing on older responses; the track page derives them from `status`. */
  timeline?: ApiApplicationTimelineStep[]
  appliedAt: string
  jobId?: string
  employerApplicationId?: string
  roleTrack?: string
  experienceLevel?: string
  shareableCode?: string
  companySlug?: string | null
  atsScore?: number
  interviewScore?: number | null
  jobStatus?: 'active' | 'deleted'
  jobDeletedAt?: string
  jobDeletedMessage?: string
}

/** HTTP status attached by callers that need to tell a 404 from other failures. */
export function apiErrorStatus(err: unknown): number | null {
  if (err && typeof err === 'object' && 'status' in err && typeof (err as { status: unknown }).status === 'number') {
    return (err as { status: number }).status
  }
  return null
}

function applicationFromPayload(data: unknown): ApiApplication | null {
  if (!data || typeof data !== 'object') return null
  const body = data as { application?: unknown; id?: unknown }
  const nested = body.application
  if (nested && typeof nested === 'object' && typeof (nested as { id?: unknown }).id === 'string') {
    return nested as ApiApplication
  }
  if (typeof body.id === 'string' && body.id) return body as ApiApplication
  return null
}

export async function apiListApplications(): Promise<ApiApplication[]> {
  // Dashboard and the Applications page both load this on mount: share one request for a few seconds.
  // Any write (apply, withdraw, profile save) clears the cache first, so a read after a write is fresh.
  const data = (await cachedRequest('/api/applications', 5_000, () => request('/api/applications'))) as {
    applications?: ApiApplication[]
  }
  return Array.isArray(data.applications) ? data.applications : []
}

/** One application. Throws an Error with `status` 404 when this application does not exist. */
export async function apiGetApplication(id: string): Promise<ApiApplication> {
  const res = await apiFetch(`/api/applications/${encodeURIComponent(id)}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const body = data && typeof data === 'object' ? (data as { error?: unknown; detail?: unknown }) : {}
    const message =
      (typeof body.error === 'string' && body.error) ||
      (typeof body.detail === 'string' && body.detail) ||
      `Request failed (${res.status})`
    const err = new Error(message)
    ;(err as Error & { status: number }).status = res.status
    throw err
  }
  const application = applicationFromPayload(data)
  if (!application) throw new Error('Application not found')
  return application
}

export async function apiWithdrawApplication(applicationId: string): Promise<ApiApplication[]> {
  const data = await request(`/api/applications/${encodeURIComponent(applicationId)}`, {
    method: 'DELETE',
  })
  return Array.isArray(data.applications) ? data.applications : []
}

export async function sendInterviewConfirmationEmail(payload: {
  scheduledStart: string
  durationMinutes?: number
  jobTitle?: string
  jobDescription?: string
  roleTrack?: string
  experienceLevel?: string
  primarySkills?: string[]
  /** The job link the slot was booked for: the server links the booking to the job / application. */
  jobId?: string
}) {
  const res = await apiFetch('/api/interview/confirmation-email', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    error?: string
    inviteUrl?: string
    emailSent?: boolean
    emailError?: string | null
    scheduledStart?: string
    scheduledEnd?: string
    token?: string
    smtpConfigured?: boolean
  }
  if (res.status === 503 && data.smtpConfigured === false) {
    throw new Error(data.error || 'SMTP not configured on server.')
  }
  if (!res.ok && !data.inviteUrl) {
    throw new Error(data.error || `Request failed (${res.status})`)
  }
  return data as {
    ok: boolean
    inviteUrl: string
    emailSent: boolean
    emailError?: string | null
    scheduledStart: string
    scheduledEnd: string
    token: string
  }
}

export async function fetchMailStatus() {
  try {
    // Server configuration: the same answer for every component that asks, so share it for a minute.
    return (await cachedRequest('/api/mail/status', 60_000, () => request('/api/mail/status'))) as {
      smtpConfigured: boolean
      inviteJoinWindowMinutes?: number
    }
  } catch {
    return { smtpConfigured: false }
  }
}

export async function apiLogout() {
  const token = getApiToken()
  try {
    if (token) {
      await apiFetch('/api/logout', { method: 'POST' })
    }
  } catch {
    // Server may be offline; still clear local session token.
  } finally {
    setApiToken(null)
  }
}

export type ApiHealthInfo = {
  ok: boolean
  llm?: boolean
  version?: string
  features?: Record<string, boolean>
}

export async function apiHealthInfo(): Promise<ApiHealthInfo | null> {
  try {
    return (await request('/api/health')) as ApiHealthInfo
  } catch {
    return null
  }
}
