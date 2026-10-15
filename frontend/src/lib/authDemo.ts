/** Local / API demo accounts (Node seed). Login uses /api/login when the API is running. */
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

export function getDemoAccount(email: string, password: string) {
  const normalized = email.trim().toLowerCase()
  return DEMO_LIST.find(
    (d) => d.email === normalized && d.password === password,
  )
}

export function isDemoEmail(email: string) {
  const normalized = email.trim().toLowerCase()
  return DEMO_LIST.some((d) => d.email === normalized)
}
