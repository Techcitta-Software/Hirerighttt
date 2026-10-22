import pg from 'pg'
import { readFile } from 'node:fs/promises'

// Explicit branch URL only. Never load .env or fall back to production DATABASE_URL.
const url = process.env.SCHEMA_DESIGN_DATABASE_URL
if (!url) throw new Error('Set SCHEMA_DESIGN_DATABASE_URL to an initialized disposable database or Neon development branch.')
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15000 })
await client.connect()
try {
  await client.query('BEGIN')
  await client.query("SET LOCAL lock_timeout = '3s'")
  await client.query("SET LOCAL statement_timeout = '60s'")
  await client.query(await readFile(new URL('./schema-v2.sql', import.meta.url), 'utf8'))
  const { rows } = await client.query("SELECT count(*)::int AS tables FROM pg_tables WHERE schemaname='hiring'")
  console.log(`Validated ${rows[0].tables} proposed tables. Rolling back all changes; no data migrated.`)
} finally {
  await client.query('ROLLBACK').catch(() => {})
  await client.end()
}
