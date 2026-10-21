/**
 * Auth provider configuration (optional).
 * — Supabase: fastest path for email/OAuth + hosted Postgres.
 * — Neon: Postgres only; pair with Supabase Auth or your FastAPI JWT (backend/python).
 */
export type AuthProvider = 'local' | 'supabase' | 'custom'

function envFirst(...keys: string[]): string {
  for (const key of keys) {
    const v = import.meta.env[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

export function authProvider(): AuthProvider {
  const raw = (import.meta.env.VITE_AUTH_PROVIDER || '').toLowerCase()
  if (raw === 'supabase') return 'supabase'
  if (raw === 'local') return 'local'
  // Node API + Neon accounts (see .env.example VITE_AUTH_PROVIDER=api)
  if (raw === 'custom' || raw === 'api' || raw === 'neon') return 'custom'
  const hasSupabase =
    Boolean(envFirst('VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL')) &&
    Boolean(envFirst('VITE_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'))
  return hasSupabase ? 'supabase' : 'local'
}

const supabaseUrl = envFirst('VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL')
const supabaseAnonKey = envFirst('VITE_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY')

export const supabaseConfig = {
  url: supabaseUrl,
  anonKey: supabaseAnonKey,
  resumeBucket: (import.meta.env.VITE_SUPABASE_RESUME_BUCKET || 'resumes').trim(),
  enabled: authProvider() === 'supabase' && Boolean(supabaseUrl && supabaseAnonKey),
  /** Resume CDN (Supabase Storage) — independent of auth provider when keys exist. */
  storageEnabled: Boolean(supabaseUrl && supabaseAnonKey),
}

/** Server Postgres (Neon / Supabase DB URL) — used by Python API when deployed. */
export const databaseUrl = import.meta.env.VITE_DATABASE_URL || ''

/** True when auth must be validated against the Node API (not local-only demo users). */
export function requireApiForAuth(): boolean {
  if (authProvider() === 'supabase') return true
  const raw = (import.meta.env.VITE_AUTH_PROVIDER || '').toLowerCase()
  return raw === 'api' || raw === 'custom'
}
