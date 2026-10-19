import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = existsSync(join(here, '..', 'package.json')) ? join(here, '..') : here
const ENV_PATH = join(REPO_ROOT, '.env')

const DEPRECATED_ENV_PATHS = [
  join(REPO_ROOT, 'backend', 'node', '.env'),
  join(REPO_ROOT, 'backend', '.env'),
  join(REPO_ROOT, 'frontend', '.env'),
  join(REPO_ROOT, 'backend', 'python', '.env'),
]

export function loadEnv() {
  for (const p of DEPRECATED_ENV_PATHS) {
    if (existsSync(p)) {
      console.warn(`[env] Deprecated ${p} — use repo-root .env only.`)
    }
  }
  if (!existsSync(ENV_PATH)) return false
  const text = readFileSync(ENV_PATH, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value
    }
  }
  return true
}

export function envFilePath() {
  return ENV_PATH
}
