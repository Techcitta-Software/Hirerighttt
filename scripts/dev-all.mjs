import { spawn } from 'node:child_process'
import { loadEnv } from '../env/loadEnv.mjs'

loadEnv()

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
