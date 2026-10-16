/**
 * Apply schema to DATABASE_URL (Neon). Safe to run multiple times.
 * Usage: DATABASE_URL=postgresql://... node db/init.mjs
 */
import pg from 'pg'
import { loadEnv } from '../loadEnv.mjs'
import { applySchema } from './applySchema.mjs'

loadEnv()

const url = process.env.DATABASE_URL
if (!url) {
  console.error('Set DATABASE_URL (Neon connection string) and retry.')
  process.exit(1)
}

const ssl = /sslmode=require|neon\.tech|supabase\.co|amazonaws\.com/i.test(url)
  ? { rejectUnauthorized: false }
  : undefined

const client = new pg.Client({ connectionString: url, ssl })
await client.connect()
try {
  await applySchema(client)
  console.log('[db:init] Schema applied successfully (SaaS + talent search).')
} finally {
  await client.end()
}
