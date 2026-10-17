import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const nodeDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function evalMail(envPatch) {
  const code = `
import { smtpConfigured } from './mail.mjs';
import { smtpAppPassword, smtpEmail } from './mailer.mjs';
console.log(JSON.stringify({
  email: smtpEmail(),
  pass: smtpAppPassword(),
  configured: smtpConfigured(),
}));
`
  const env = {
    ...process.env,
    SMTP_EMAIL: '',
    SMTP_APP_PASSWORD: '',
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

test('Gmail app password is detected when SMTP_EMAIL and SMTP_APP_PASSWORD are set', () => {
  const without = evalMail({})
  assert.equal(without.configured, false)

  const withGmail = evalMail({
    SMTP_EMAIL: 'project@gmail.com',
    SMTP_APP_PASSWORD: 'abcd efgh ijkl mnop',
  })
  assert.equal(withGmail.email, 'project@gmail.com')
  assert.equal(withGmail.pass, 'abcdefghijklmnop')
  assert.equal(withGmail.configured, true)
})
