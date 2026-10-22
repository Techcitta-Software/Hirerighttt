/**
 * Free PORT (default 8787) before dev:all so a stale API cannot serve old S3 code/env.
 */
import { execSync } from 'node:child_process'
import { loadEnv } from '../env/loadEnv.mjs'

loadEnv()

const port = Number(process.env.PORT || 8787)
const isWin = process.platform === 'win32'

function pidsOnPort(p) {
  try {
    if (isWin) {
      const out = execSync(`netstat -ano | findstr ":${p}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] })
      const pids = new Set()
      for (const line of out.split(/\r?\n/)) {
        if (!line.includes('LISTENING')) continue
        const parts = line.trim().split(/\s+/)
        const pid = Number(parts[parts.length - 1])
        if (Number.isFinite(pid) && pid > 0) pids.add(pid)
      }
      return [...pids]
    }
    const out = execSync(`lsof -ti :${p}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] })
    return out
      .split(/\s+/)
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n > 0)
  } catch {
    return []
  }
}

const pids = pidsOnPort(port)
if (!pids.length) {
  console.log(`[dev] Port ${port} is free.`)
  process.exit(0)
}

console.warn(
  `[dev] Port ${port} in use (PID ${pids.join(', ')}) — stopping stale API so .env S3 settings apply.`,
)
for (const pid of pids) {
  try {
    if (isWin) execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' })
    else execSync(`kill -9 ${pid}`, { stdio: 'ignore' })
    console.log(`[dev] Stopped PID ${pid}`)
  } catch (err) {
    console.error(`[dev] Could not stop PID ${pid}:`, err instanceof Error ? err.message : err)
    process.exit(1)
  }
}
