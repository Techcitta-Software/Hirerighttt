import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabaseConfig } from './authConfig'

let client: SupabaseClient | null = null

export function isSupabaseEnabled(): boolean {
  return supabaseConfig.enabled
}

export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfig.enabled) return null
  if (!client) {
    client = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  }
  return client
}
