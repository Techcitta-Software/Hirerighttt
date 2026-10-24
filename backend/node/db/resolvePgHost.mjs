import dns from 'node:dns'
import { configureDns } from '../configureDns.mjs'

/**
 * Windows dns.lookup() uses the OS resolver (often broken on ISP routers).
 * pg uses lookup → resolve via c-ares resolve4 when we pass an IP + TLS servername.
 */
export async function resolvePgHost(hostname) {
  configureDns()
  try {
    const ipv4 = await dns.promises.resolve4(hostname)
    if (ipv4?.length) {
      return { host: ipv4[0], servername: hostname }
    }
  } catch {
    /* fall through */
  }
  return { host: hostname, servername: undefined }
}
