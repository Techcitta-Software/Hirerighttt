import { spawn, execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from '../env/loadEnv.mjs'

loadEnv()

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const apiPort = Number(process.env.PORT || 8787)
const frontendPort = Number(process.env.VITE_DEV_PORT || 5173)
const viteCmd = join(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vite.cmd' : 'vite',
)

for (const script of ['ensure-dev-api-port.mjs', 'ensure-dev-frontend-port.mjs']) {
  try {
    execSync(`node scripts/${script}`, { stdio: 'inherit', cwd: repoRoot })
  } catch {
    process.exit(1)
  }
}

const children = []

function shutdown(code = 0) {
  for (const child of children) {
    if (child.exitCode == null && child.pid) {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', shell: false })
        } else {
          child.kill('SIGTERM')
        }
      } catch {
        // ignore
      }
    }
  }
  setTimeout(() => process.exit(code), 300).unref()
}

process.on('SIGINT', () => {
  console.log('\n[dev] Shutting down…')
  shutdown(0)
})
process.on('SIGTERM', () => shutdown(0))

function run(command, args, options = {}) {
  const env = { ...process.env, PORT: String(apiPort), VITE_DEV_PORT: String(frontendPort) }
  if (process.env.CHOKIDAR_USEPOLLING === 'true') {
    env.CHOKIDAR_USEPOLLING = 'true'
  }
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: options.shell === true,
    env,
    cwd: options.cwd ?? repoRoot,
  })
  child.on('error', (err) => {
    console.error(err)
  })
  children.push(child)
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

run('python', ['run.py'], { cwd: join(repoRoot, 'backend') })
await waitForApiHealth()
run(viteCmd, [], { cwd: join(repoRoot, 'frontend'), shell: true })

console.log(`[dev] Frontend → http://127.0.0.1:${frontendPort}/  (API proxy → http://127.0.0.1:${apiPort})`)
