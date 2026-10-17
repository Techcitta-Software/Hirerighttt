import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const nodeDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function evalMail(envPatch) {
  const code = `
import { smtpPassword, smtpConfigured } from './mail.mjs';
console.log(JSON.stringify({ pass: smtpPassword(), configured: smtpConfigured() }));
`
  const env = {
    ...process.env,
    SMTP_PASS: '',
    SENDGRID_API_KEY: '',
    SMTP_API_KEY: '',
    SMTP_HOST: 'smtp.sendgrid.net',
    SMTP_USER: 'apikey',
    ...envPatch,
  }
  const r = spawnSync('node', ['--input-type=module', '-e', code], {
    cwd: nodeDir,
    env,
    encoding: 'utf8',
  })
  assert.equal(r.status, 0, r.stderr || r.stdout)
  return JSON.parse(r.stdout.trim())
}

test('smtpPassword accepts SendGrid API key when SMTP_PASS is unset', () => {
  const without = evalMail({})
  assert.equal(without.pass, '')
  assert.equal(without.configured, false)

  const withKey = evalMail({ SENDGRID_API_KEY: 'SG.test-key' })
  assert.equal(withKey.pass, 'SG.test-key')
  assert.equal(withKey.configured, true)
})
