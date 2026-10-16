import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const monorepoLoader = join(here, '..', '..', 'env', 'loadEnv.mjs')

const DEPRECATED_ENV_PATHS = (repoRoot) => [
  join(repoRoot, 'backend', 'node', '.env'),
  join(repoRoot, 'backend', '.env'),
  join(repoRoot, 'frontend', '.env'),
  join(repoRoot, 'backend', 'python', '.env'),
]

function warnDeprecatedEnvFiles(repoRoot) {
  for (const p of DEPRECATED_ENV_PATHS(repoRoot)) {
    if (existsSync(p)) {
      console.warn(`[env] Deprecated ${p} — use repo-root .env only.`)
    }
  }
}

function applyEnvFile(envPath) {
  const text = readFileSync(envPath, 'utf8')
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
}

function createStandaloneEnv() {
  /** Repo root when cwd is backend/node (Render) or monorepo checkout */
  const repoRoot = existsSync(join(here, '..', '..', 'package.json'))
    ? join(here, '..', '..')
    : join(here, '..')

  const ENV_PATH = join(repoRoot, '.env')

  function loadEnv() {
    warnDeprecatedEnvFiles(repoRoot)
    if (!existsSync(ENV_PATH)) return false
    applyEnvFile(ENV_PATH)
    return true
  }

  function envFilePath() {
    return ENV_PATH
  }

  return { loadEnv, REPO_ROOT: repoRoot, envFilePath }
}

let loadEnv
let REPO_ROOT
let envFilePath

if (existsSync(monorepoLoader)) {
  ;({ loadEnv, REPO_ROOT, envFilePath } = await import(pathToFileURL(monorepoLoader).href))
} else {
  ;({ loadEnv, REPO_ROOT, envFilePath } = createStandaloneEnv())
}

export { loadEnv, REPO_ROOT, envFilePath }
