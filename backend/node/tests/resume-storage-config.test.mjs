import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const nodeDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

test('supabaseStorageConfigured reads NEXT_PUBLIC and VITE aliases', () => {
  const code = `
import { supabaseEnv, supabaseStorageConfigured } from './resumeStorage.mjs';
const e = supabaseEnv();
console.log(JSON.stringify({ url: e.url, bucket: e.bucket, configured: supabaseStorageConfigured() }));
`
  const r = spawnSync('node', ['--input-type=module', '-e', code], {
    cwd: nodeDir,
    env: {
      ...process.env,
      SUPABASE_URL: '',
      SUPABASE_ANON_KEY: '',
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_RESUME_BUCKET: 'resumes',
    },
    encoding: 'utf8',
  })
  assert.equal(r.status, 0, r.stderr || r.stdout)
  const out = JSON.parse(r.stdout.trim())
  assert.equal(out.url, 'https://example.supabase.co')
  assert.equal(out.bucket, 'resumes')
  assert.equal(out.configured, true)
})
