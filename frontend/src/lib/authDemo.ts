/** Local / API demo accounts (Node seed). Supabase may not have these users — login falls back when credentials match. */
export const DEMO_CANDIDATE = {
  email: 'demo@hireright.com',
  password: 'password123',
  name: 'Arjun Sharma',
  role: 'jobseeker' as const,
}

export const DEMO_EMPLOYER = {
  email: 'employer@hireright.com',
  password: 'password123',
  name: 'Sarah Jenkins',
  companyName: 'TechCitta Solutions',
  role: 'employer' as const,
}

export const DEMO_ADMIN = {
  email: 'admin@hireright.com',
  password: 'password123',
  name: 'Alex Morgan',
  companyName: 'HIRERIGHT Recruiting',
  role: 'employer' as const,
}

const DEMO_LIST = [DEMO_CANDIDATE, DEMO_EMPLOYER, DEMO_ADMIN] as const

/** Demo credentials are honoured only in local development or when explicitly enabled. */
const DEMO_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO_ACCOUNTS === 'true'

export function getDemoAccount(email: string, password: string) {
  if (!DEMO_ENABLED) return undefined
  const normalized = email.trim().toLowerCase()
  return DEMO_LIST.find(
    (d) => d.email === normalized && d.password === password,
  )
}

export function isDemoEmail(email: string) {
  if (!DEMO_ENABLED) return false
  const normalized = email.trim().toLowerCase()
  return DEMO_LIST.some((d) => d.email === normalized)
}
