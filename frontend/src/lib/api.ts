/** Thin client for the optional Node API. Falls back silently when offline. */
const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

const TOKEN_KEY = 'hireright.apiToken'

/** Re-export for API callers; canonical definitions live in authDemo.ts */
export { DEMO_CANDIDATE } from './authDemo'

export function getApiToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function setApiToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

/** Same-origin `/api` in Vite dev; absolute URL when `VITE_API_URL` is set. */
export function apiUrl(path: string) {
  const p = path.startsWith('/') ? path : `/${path}`
  return API_BASE ? `${API_BASE}${p}` : p
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }
  const token = getApiToken()
  if (token) headers.Authorization = `Bearer ${token}`
  return fetch(apiUrl(path), { ...options, headers })
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
  try {
    const data = await request('/api/health')
    return Boolean(data.ok)
  } catch {
    return false
  }
}

export async function apiSignup(
  name: string,
  email: string,
  password: string,
  extras?: { role?: 'jobseeker' | 'employer'; companyName?: string; phone?: string },
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
  setApiToken(data.token)
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
