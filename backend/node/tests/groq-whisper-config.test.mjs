import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const nodeDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function evalGroq(envPatch) {
  const code = `
import {
  groqWhisperConfigured,
  groqWhisperModel,
  groqWhisperLanguage,
} from './groqWhisper.mjs';
console.log(JSON.stringify({
  configured: groqWhisperConfigured(),
  model: groqWhisperModel(),
  language: groqWhisperLanguage(),
}));
`
  const env = {
    ...process.env,
    GROQ_API_KEY: '',
    GROQ_WHISPER_MODEL: '',
    GROQ_WHISPER_LANGUAGE: '',
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

test('Groq Whisper config defaults and detection', () => {
  const without = evalGroq({})
  assert.equal(without.configured, false)
  assert.equal(without.model, 'whisper-large-v3-turbo')
  assert.equal(without.language, 'en')

  const withKey = evalGroq({
    GROQ_API_KEY: 'gsk_test',
    GROQ_WHISPER_MODEL: 'whisper-large-v3-turbo',
    GROQ_WHISPER_LANGUAGE: 'en',
  })
  assert.equal(withKey.configured, true)
  assert.equal(withKey.model, 'whisper-large-v3-turbo')
  assert.equal(withKey.language, 'en')
})
