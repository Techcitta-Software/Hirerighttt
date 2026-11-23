#!/usr/bin/env node
/**
 * Scans git-tracked text files for accidental secret patterns. Used in CI and vulnerability-scan-agent.
 * Exit 1 if probable live secrets found.
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

const TRACKED = execSync('git ls-files', { cwd: root, encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((f) => !f.startsWith('frontend/dist/'))

const ALLOW_FILES = new Set([
  '.env.example',
  'backend/.env.example',
  'infra/aws-free/config.env',
  'scripts/secret-scan.mjs',
  '.cursor/skills/vulnerability-scan-agent/SKILL.md',
])

const PLACEHOLDER = /(?:placeholder|example|CHANGE_ME|your[-_]|ci-key|ci-smoke|password123|xxx|<.*>|not set|\|\| ''|VITE_GEMINI_API_KEY)/i

function fileText(rel) {
  const abs = path.join(root, rel)
  if (fs.existsSync(abs)) {
    try {
      return fs.readFileSync(abs, 'utf8')
    } catch {
      return ''
    }
  }
  try {
    return execSync(`git show HEAD:${rel.replace(/\\/g, '/')}`, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    })
  } catch {
    return ''
  }
}

const checks = [
  {
    name: 'Google API key',
    re: /AIza[0-9A-Za-z_-]{25,}/,
    skipLine: (line) => PLACEHOLDER.test(line),
  },
  {
    name: 'AWS access key',
    re: /AKIA[0-9A-Z]{16}/,
    skipFile: (rel) => /test_|tests\//.test(rel),
    skipLine: (line) => /fake|mock|example|test/i.test(line),
  },
  {
    name: 'Stripe live',
    re: /sk_live_[0-9a-zA-Z]{16,}/,
  },
  {
    name: 'Assigned secret (non-placeholder)',
    re: /^(?:GEMINI_API_KEY|SMTP_APP_PASSWORD|SESSION_SECRET|RAZORPAY_KEY_SECRET|AWS_SECRET_ACCESS_KEY)\s*=\s*(\S+)/m,
    lineOnly: true,
    skipLine: (line, m) => {
      const val = m?.[1] || ''
      if (!val || val.length < 16) return true
      return PLACEHOLDER.test(line)
    },
  },
  {
    name: 'Postgres URL with real password',
    re: /postgresql:\/\/[^:\s]+:([^@\s]+)@[^/\s]+/,
    skipFile: (rel) =>
      rel.includes('.github/workflows/') ||
      rel.includes('test_') ||
      rel.includes('/tests/'),
    skipLine: (line, m) => {
      const pass = m?.[1] || ''
      if (line.includes('${') || line.includes('{password}') || line.includes('{user}')) return true
      return ['postgres', 'password', 'p', 'user:password', 'u:p'].includes(pass) || PLACEHOLDER.test(line)
    },
  },
]

const hits = []

for (const rel of TRACKED) {
  if (ALLOW_FILES.has(rel)) continue
  if (/\.(png|jpg|jpeg|gif|webp|mp4|woff2?|ico|pdf)$/i.test(rel)) continue
  const text = fileText(rel)
  if (!text) continue

  const lines = text.split(/\r?\n/)
  for (const check of checks) {
    if (check.skipFile?.(rel)) break
    if (check.lineOnly) {
      for (const line of lines) {
        const m = line.match(check.re)
        if (m && !check.skipLine?.(line, m)) {
          hits.push({ file: rel, pattern: check.name })
          break
        }
      }
    } else {
      for (const line of lines) {
        if (!check.re.test(line)) continue
        if (check.skipLine?.(line)) continue
        hits.push({ file: rel, pattern: check.name })
        break
      }
    }
    if (hits.length && hits[hits.length - 1].file === rel) break
  }
}

if (hits.length) {
  console.error('Probable secrets in tracked files:')
  for (const h of hits) {
    console.error(`  [${h.pattern}] ${h.file}`)
  }
  process.exit(1)
}

console.log(`secret-scan: OK (${TRACKED.length} tracked files checked)`)