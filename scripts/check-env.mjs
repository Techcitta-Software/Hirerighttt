/**
 * Warn if legacy .env files exist (use repo-root .env only).
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../env/loadEnv.mjs'

const deprecated = [
  'backend/node/.env',
  'backend/.env',
  'frontend/.env',
  'backend/python/.env',
]

let found = false
for (const rel of deprecated) {
  const p = join(REPO_ROOT, rel)
  if (existsSync(p)) {
    console.warn(`[check-env] Remove deprecated ${rel} — use repo-root .env only`)
    found = true
  }
}

const rootEnv = join(REPO_ROOT, '.env')
if (!existsSync(rootEnv)) {
  console.warn('[check-env] Missing repo-root .env — copy from .env.example')
  process.exitCode = 1
} else if (!found) {
  console.log('[check-env] OK — single repo-root .env')
}
