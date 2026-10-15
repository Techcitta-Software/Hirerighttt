import { spawn } from 'node:child_process'
import { loadEnv } from '../env/loadEnv.mjs'

loadEnv()

function run(command, args) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, CHOKIDAR_USEPOLLING: 'true' },
  })
  child.on('error', (err) => {
    console.error(err)
  })
}

run('node', ['backend/node/index.mjs'])
run('npm', ['--prefix', 'frontend', 'run', 'dev'])
