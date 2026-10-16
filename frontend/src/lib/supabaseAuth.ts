import type { Session, User } from '@supabase/supabase-js'
import { setApiToken } from './api'
import { getSupabase, isSupabaseEnabled } from './supabaseClient'
import { saveUser, type UserRole } from './store'

export async function supabaseSignUp(options: {
  name: string
  email: string
  password: string
  role?: UserRole
  companyName?: string
  phone?: string
}) {
  const sb = getSupabase()
  if (!sb) return { error: new Error('Supabase is not configured.') }

  const { data, error } = await sb.auth.signUp({
    email: options.email.trim().toLowerCase(),
    password: options.password,
    options: {
      data: {
        name: options.name.trim(),
        role: options.role || 'jobseeker',
        companyName: options.companyName || null,
        phone: options.phone || null,
      },
    },
  })
  if (error) return { error, session: null, user: null }
  if (data.session) applySupabaseSession(data.session, data.user)
  return { error: null, session: data.session, user: data.user }
}

export async function supabaseSignIn(email: string, password: string) {
  const sb = getSupabase()
  if (!sb) return { error: new Error('Supabase is not configured.') }

  const { data, error } = await sb.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  })
  if (error) return { error, session: null, user: null }
  applySupabaseSession(data.session, data.user)
  return { error: null, session: data.session, user: data.user }
}

export async function supabaseSignOut() {
  const sb = getSupabase()
  if (sb) await sb.auth.signOut()
  setApiToken(null)
}

export function applySupabaseSession(session: Session | null, user: User | null) {
  if (!session?.access_token || !user?.email) return
  setApiToken(session.access_token)

  const meta = user.user_metadata || {}
  const role = (meta.role === 'employer' ? 'employer' : 'jobseeker') as UserRole
  saveUser(
    {
      name: String(meta.name || user.email.split('@')[0]),
      email: user.email.toLowerCase(),
      password: '',
      role,
      companyName: meta.companyName ? String(meta.companyName) : undefined,
    },
    true,
  )
}

export async function refreshSupabaseApiToken(): Promise<boolean> {
  if (!isSupabaseEnabled()) return false
  const sb = getSupabase()
  if (!sb) return false
  const { data, error } = await sb.auth.getSession()
  if (error || !data.session?.access_token) return false
  setApiToken(data.session.access_token)
  return true
}
