/**
 * Download Playwright Chromium after npm install so scorecard PDFs can upload to S3.
 * Skip: PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
 * CI skip unless: PLAYWRIGHT_INSTALL_CHROMIUM=1
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const skipDownload = process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === '1'
const ci = process.env.CI === 'true'
const forceInCi = process.env.PLAYWRIGHT_INSTALL_CHROMIUM === '1'

if (skipDownload) {
  console.log('[playwright] PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 — skipping Chromium.')
  process.exit(0)
}

if (ci && !forceInCi) {
  console.log(
    '[playwright] CI detected — skipping Chromium (~300MB). Set PLAYWRIGHT_INSTALL_CHROMIUM=1 to install.',
  )
  process.exit(0)
}

const require = createRequire(import.meta.url)
let cli
try {
  cli = require.resolve('playwright/cli.js')
} catch {
  console.warn('[playwright] playwright package not installed — skipping Chromium download.')
  process.exit(0)
}

console.log('[playwright] Installing Chromium for HireRight scorecard PDFs…')
const result = spawnSync(process.execPath, [cli, 'install', 'chromium'], {
  stdio: 'inherit',
  env: process.env,
})

if (result.status !== 0) {
  console.warn('[playwright] Chromium download failed. Interview report PDFs will not upload to S3.')
  console.warn('  Retry: npm run playwright:install-chromium')
  process.exit(0)
}

console.log('[playwright] Chromium is ready.')
