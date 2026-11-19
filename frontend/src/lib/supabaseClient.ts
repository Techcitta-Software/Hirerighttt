import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseConfig } from './authConfig'

let client: SupabaseClient | null = null
let clientPromise: Promise<SupabaseClient | null> | null = null

export function isSupabaseEnabled(): boolean {
  return supabaseConfig.enabled
}

/**
 * Lazily loads @supabase/supabase-js (a large library) only when Supabase auth is enabled,
 * so it never ships in the initial bundle.
 */
export function getSupabase(): Promise<SupabaseClient | null> {
  if (!supabaseConfig.enabled) return Promise.resolve(null)
  if (client) return Promise.resolve(client)
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js')
      .then(({ createClient }) => {
        client = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
          },
        })
        return client
      })
      .catch((err) => {
        clientPromise = null
        throw err
      })
  }
  return clientPromise
}
