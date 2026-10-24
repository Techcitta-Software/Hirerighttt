import { resolvePgHost } from './resolvePgHost.mjs'

export function pgSsl(databaseUrl) {
  if (/sslmode=require|neon\.tech|amazonaws\.com/i.test(databaseUrl)) {
    return { rejectUnauthorized: false }
  }
  return undefined
}

/**
 * pg Client/Pool options that work when OS DNS cannot resolve Neon (Windows ISP routers).
 * @param {string} databaseUrl
 */
export async function pgConnectConfig(databaseUrl) {
  const url = String(databaseUrl || '').trim()
  const parsed = new URL(url)
  const resolved = await resolvePgHost(parsed.hostname)
  const sslBase = pgSsl(url)
  if (!resolved.servername) {
    return { connectionString: url, ssl: sslBase }
  }
  const ssl = sslBase ? { ...sslBase, servername: resolved.servername } : undefined
  return {
    host: resolved.host,
    port: Number(parsed.port || 5432),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    ssl,
  }
}
