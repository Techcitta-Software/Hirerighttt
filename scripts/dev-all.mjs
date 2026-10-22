import { spawn, execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from '../env/loadEnv.mjs'

loadEnv()

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
try {
  execSync('node scripts/ensure-dev-api-port.mjs', { stdio: 'inherit', cwd: repoRoot })
} catch {
  process.exit(1)
}

function run(command, args) {
  const env = { ...process.env }
  // Polling file watches peg CPU on Windows and make Vite/React feel laggy; opt-in only.
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
}

run('node', ['backend/node/index.mjs'])
run('npm', ['--prefix', 'frontend', 'run', 'dev'])
