import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const monorepoLoader = join(here, '..', '..', 'env', 'loadEnv.mjs')
const dockerLoader = join(here, 'env', 'loadEnv.mjs')
const loaderPath = existsSync(monorepoLoader) ? monorepoLoader : dockerLoader

if (!existsSync(loaderPath)) {
  throw new Error('Missing env/loadEnv.mjs — run from monorepo root layout.')
}

export const { loadEnv, REPO_ROOT, envFilePath } = await import(pathToFileURL(loaderPath).href)
