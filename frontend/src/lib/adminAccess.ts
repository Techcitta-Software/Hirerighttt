import { getUser } from './store'

/**
 * Interview recordings are visible to platform admins only (never candidates or recruiters).
 * Admin emails: the built-in admin account plus any listed in VITE_ADMIN_EMAILS (comma separated).
 * NOTE: this is a UI gate — the API must also refuse recording access to non-admins.
 */
const BUILTIN_ADMIN_EMAILS = import.meta.env.DEV ? ['admin@hireright.com'] : []

function adminEmails(): string[] {
  const extra = String(import.meta.env.VITE_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return [...BUILTIN_ADMIN_EMAILS, ...extra]
}

export function isAdminUser(): boolean {
  const user = getUser()
  if (!user?.email) return false
  return user.role === 'employer' && adminEmails().includes(user.email.trim().toLowerCase())
}
