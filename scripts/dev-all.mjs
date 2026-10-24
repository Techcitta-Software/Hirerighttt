import { spawn, execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from '../env/loadEnv.mjs'

loadEnv()

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const apiPort = Number(process.env.PORT || 8787)

try {
  execSync('node scripts/ensure-dev-api-port.mjs', { stdio: 'inherit', cwd: repoRoot })
} catch {
  process.exit(1)
}

function run(command, args) {
  const env = { ...process.env }
  if (process.env.CHOKIDAR_USEPOLLING === 'true') {
    env.CHOKIDAR_USEPOLLING = 'true'
  }
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: true,
    env,
  })
  child.on('error', (err) => {
    console.error(err)
  })
  return child
}

async function waitForApiHealth(maxMs = 120_000) {
  const url = `http://127.0.0.1:${apiPort}/api/health`
  const started = Date.now()
  process.stdout.write('[dev] Waiting for API (Neon bootstrap can take 30–60s)')
  while (Date.now() - started < maxMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3_000) })
      if (res.ok) {
        process.stdout.write('\n')
        console.log(`[dev] API ready on port ${apiPort}`)
        return true
      }
    } catch {
      // API still starting or DB connecting
    }
    process.stdout.write('.')
    await new Promise((r) => setTimeout(r, 800))
  }
  process.stdout.write('\n')
  console.warn(
    `[dev] API did not respond on ${url} within ${Math.round(maxMs / 1000)}s — starting Vite anyway (check Neon/network).`,
  )
  return false
}

run('node', ['backend/node/index.mjs'])
await waitForApiHealth()
run('npm', ['--prefix', 'frontend', 'run', 'dev'])
