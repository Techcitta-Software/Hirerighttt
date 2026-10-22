/** Thin client for the optional Node API. Falls back silently when offline. */
const ENV_API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
/** When Vite proxy is down, dev builds may talk to the API directly (CORS must allow the page origin). */
const DEV_API_FALLBACK = (
  import.meta.env.VITE_DEV_API_FALLBACK || 'http://127.0.0.1:8787'
).replace(/\/$/, '')

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
  if (resolveApiBasePromise) return resolveApiBasePromise
  resolveApiBasePromise = (async () => {
    if (await pingHealth('')) {
      runtimeApiBase = ''
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
}

/** Same-origin `/api` in Vite dev; absolute URL when `VITE_API_URL` or dev fallback is set. */
export function apiUrl(path: string) {
  const p = path.startsWith('/') ? path : `/${path}`
  const base = runtimeApiBase || ENV_API_BASE
  return base ? `${base}${p}` : p
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  await resolveApiBase()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }
  const token = getApiToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const timeoutMs = import.meta.env.DEV ? 25_000 : 45_000
  const signal =
    options.signal ??
    (typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined)
  return fetch(apiUrl(path), { ...options, headers, signal })
}

async function request(path: string, options: RequestInit = {}) {
  const res = await apiFetch(path, options)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

export async function apiMe() {
  return request('/api/me')
}

export async function apiHealth() {
  if (healthCache && Date.now() - healthCache.at < HEALTH_CACHE_MS) {
    return healthCache.ok
  }
  await resolveApiBase()
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

export async function apiSaveProfile(profile: unknown) {
  return request('/api/profile', {
    method: 'PUT',
    body: JSON.stringify(profile),
  })
}

export async function apiSaveInterview(interview: unknown) {
  return request('/api/interview', {
    method: 'POST',
    body: JSON.stringify(interview),
  })
}

export type ApiApplication = {
  id: string
  title: string
  company: string
  location: string
  match: number
  status: 'Applied' | 'In Review' | 'Interview' | 'Offer'
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

export async function apiListApplications(): Promise<ApiApplication[]> {
  const data = await request('/api/applications')
  return Array.isArray(data.applications) ? data.applications : []
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
    return (await request('/api/mail/status')) as { smtpConfigured: boolean }
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
