import dns from 'node:dns'

/**
 * Some home routers refuse external DNS queries (Neon → getaddrinfo ENOTFOUND).
 * Use reliable public resolvers in Node before pg connects. Override with USE_SYSTEM_DNS=true.
 */
export function configureDns() {
  if (process.env.USE_SYSTEM_DNS === 'true') return

  const raw = (process.env.DNS_SERVERS || '').trim()
  if (/^(off|false|0)$/i.test(raw)) return

  const servers = raw
    ? raw.split(',').map((s) => s.trim()).filter(Boolean)
    : ['8.8.8.8', '1.1.1.1', '8.8.4.4']

  try {
    dns.setServers(servers)
    dns.setDefaultResultOrder('ipv4first')
  } catch (err) {
    console.warn('[dns] Could not set resolver servers:', err instanceof Error ? err.message : err)
  }
}
