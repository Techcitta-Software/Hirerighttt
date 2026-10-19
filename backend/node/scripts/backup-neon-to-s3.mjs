/**
 * Dump Neon Postgres (DATABASE_URL) and upload to S3.
 *
 * Requires: pg_dump on PATH, AWS credentials in .env
 *
 * Repo root:
 *   npm run db:backup:s3
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadEnv } from '../loadEnv.mjs'

loadEnv()

const databaseUrl = process.env.DATABASE_URL?.trim()
const bucket = process.env.S3_BACKUP_BUCKET?.trim()
const prefix = (process.env.S3_BACKUP_PREFIX || 'neon/hireright/').replace(/\/?$/, '/')
const region = process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim()

if (!databaseUrl) {
  console.error('[backup] DATABASE_URL is required in repo-root .env')
  process.exit(1)
}
if (!bucket) {
  console.error('[backup] Set S3_BACKUP_BUCKET in .env')
  process.exit(1)
}
if (!process.env.AWS_ACCESS_KEY_ID?.trim() || !process.env.AWS_SECRET_ACCESS_KEY?.trim()) {
  console.error('[backup] Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env')
  process.exit(1)
}

function hasPgDump() {
  const r = spawnSync('pg_dump', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' })
  return r.status === 0
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const fileName = `hireright-neon-${stamp}.sql.gz`
const localPath = join(tmpdir(), fileName)
const s3Key = `${prefix}${fileName}`

async function dumpToGzip() {
  console.log('[backup] Running pg_dump…')
  const dump = spawnSync(
    'pg_dump',
    [databaseUrl, '--no-owner', '--no-acl', '--format=plain'],
    { encoding: 'buffer', shell: process.platform === 'win32', maxBuffer: 512 * 1024 * 1024 },
  )
  if (dump.status !== 0) {
    const err = dump.stderr?.toString() || 'pg_dump failed'
    throw new Error(err)
  }
  const gz = gzipSync(dump.stdout)
  writeFileSync(localPath, gz)
  console.log('[backup] Wrote', localPath, `(${(gz.length / 1024 / 1024).toFixed(2)} MB)`)
}

async function uploadWithAwsCli() {
  const aws = spawnSync(
    'aws',
    ['s3', 'cp', localPath, `s3://${bucket}/${s3Key}`, '--only-show-errors'],
    {
      encoding: 'utf8',
      shell: process.platform === 'win32',
      env: { ...process.env, AWS_REGION: region || process.env.AWS_REGION || 'us-east-1' },
    },
  )
  if (aws.status !== 0) {
    throw new Error(aws.stderr || aws.stdout || 'aws s3 cp failed — install AWS CLI v2?')
  }
  console.log('[backup] Uploaded s3://' + bucket + '/' + s3Key)
}

async function main() {
  if (!hasPgDump()) {
    console.error(
      '[backup] pg_dump not found. Install PostgreSQL client tools and add to PATH.\n' +
        '  Windows: https://www.postgresql.org/download/windows/',
    )
    process.exit(1)
  }
  try {
    await dumpToGzip()
    await uploadWithAwsCli()
  } finally {
    if (existsSync(localPath)) {
      try {
        unlinkSync(localPath)
      } catch {
        /* ignore */
      }
    }
  }
}

main().catch((err) => {
  console.error('[backup] Failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
