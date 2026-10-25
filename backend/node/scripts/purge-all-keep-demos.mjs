/**
 * Wipe S3 app objects + Neon data; re-seed only demo@ / employer@ / admin@ hireright.com.
 *
 *   node backend/node/scripts/purge-all-keep-demos.mjs --dry-run
 *   CONFIRM_FULL_PURGE=yes node backend/node/scripts/purge-all-keep-demos.mjs
 *
 * Skips S3 when AWS is not configured (--skip-s3).
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const dryRun = process.argv.includes('--dry-run')
const skipS3 = process.argv.includes('--skip-s3')

if (process.env.CONFIRM_FULL_PURGE !== 'yes' && !dryRun) {
  console.error(
    '[purge-all] Set CONFIRM_FULL_PURGE=yes to wipe S3 + Neon (demos only remain).\n' +
      '  Or use --dry-run to preview S3 listing only.',
  )
  process.exit(1)
}

function runNode(scriptRel, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const script = join(repoRoot, scriptRel)
    const env = { ...process.env, ...extraEnv }
    const child = spawn(process.execPath, [script, ...(dryRun ? ['--dry-run'] : [])], {
      cwd: repoRoot,
      env,
      stdio: 'inherit',
    })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${scriptRel} exited ${code}`))
    })
  })
}

async function main() {
  console.log('[purge-all] Keep only demo accounts:', 'demo@, employer@, admin@hireright.com')
  if (!skipS3) {
    console.log('[purge-all] Step 1/2 — S3 (tenants/, resumes/)')
    try {
      await runNode('backend/node/scripts/s3-purge-object-data.mjs', {
        CONFIRM_S3_PURGE: dryRun ? '' : 'yes',
      })
    } catch (err) {
      console.warn('[purge-all] S3 purge failed (check AWS in .env):', err.message)
      if (!dryRun) console.warn('[purge-all] Continuing with Neon purge…')
    }
  } else {
    console.log('[purge-all] Skipping S3 (--skip-s3)')
  }

  if (dryRun) {
    console.log('[purge-all] Dry run — Neon purge skipped.')
    return
  }

  console.log('[purge-all] Step 2/2 — Neon (purge + re-seed demos)')
  await runNode('backend/node/scripts/purge-keep-demo-accounts.mjs', {
    CONFIRM_PURGE: 'yes',
  })
  console.log('[purge-all] Complete.')
}

main().catch((err) => {
  console.error('[purge-all] failed:', err.message || err)
  process.exit(1)
})
