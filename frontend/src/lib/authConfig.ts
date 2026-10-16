/**
 * Auth provider configuration (optional).
 * — Supabase: fastest path for email/OAuth + hosted Postgres.
 * — Neon: Postgres only; pair with Supabase Auth or your FastAPI JWT (backend/python).
 */
export type AuthProvider = 'local' | 'supabase' | 'custom'

export function authProvider(): AuthProvider {
  const raw = (import.meta.env.VITE_AUTH_PROVIDER || '').toLowerCase()
  if (raw === 'supabase') return 'supabase'
  if (raw === 'local') return 'local'
  if (raw === 'custom') return 'custom'
  const hasSupabase =
    Boolean(import.meta.env.VITE_SUPABASE_URL?.trim()) &&
    Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY?.trim())
  return hasSupabase ? 'supabase' : 'local'
}

export const supabaseConfig = {
  url: (import.meta.env.VITE_SUPABASE_URL || '').trim(),
  anonKey: (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim(),
  enabled:
    authProvider() === 'supabase' &&
    Boolean(import.meta.env.VITE_SUPABASE_URL?.trim()) &&
    Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()),
}

/** Server Postgres (Neon / Supabase DB URL) — used by Python API when deployed. */
export const databaseUrl = import.meta.env.VITE_DATABASE_URL || ''

/** True when auth must be validated against the Node API (not local-only demo users). */
export function requireApiForAuth(): boolean {
  if (authProvider() === 'supabase') return true
  const raw = (import.meta.env.VITE_AUTH_PROVIDER || '').toLowerCase()
  return raw === 'api' || raw === 'custom'
}
