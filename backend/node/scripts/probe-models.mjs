/**
 * Dev utility: probe which LLM base URL + model names work with your local keys.
 * Keys must live in repo-root .env (gitignored) — never hardcode secrets here.
 *
 * Usage: node backend/node/scripts/probe-models.mjs
 */
import { loadEnv } from '../loadEnv.mjs'

loadEnv()

const k =
  process.env.PROBE_KEY ||
  process.env.EXPERIENTIALLABS_API_KEY ||
  process.env.GEMINI_API_KEY ||
  process.env.OPENAI_API_KEY ||
  ''

if (!k) {
  console.error(
    'Missing API key. Set PROBE_KEY or GEMINI_API_KEY / OPENAI_API_KEY / EXPERIENTIALLABS_API_KEY in .env at repo root.',
  )
  process.exit(1)
}

const bases = [
  {
    name: 'experiential',
    url: 'https://api.experientiallabs.ai/v1/chat/completions',
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  {
    name: 'google-openai',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    headers: (key) => ({ Authorization: `Bearer ${key}`, 'x-goog-api-key': key }),
  },
]

const models = ['gpt-6-luna', 'gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-2.0-flash', 'qwen3.8-27b']

for (const base of bases) {
  for (const model of models) {
    const res = await fetch(base.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...base.headers(k) },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Say OK' }],
        max_tokens: 5,
      }),
    })
    const text = await res.text()
    console.log(base.name, model, res.status, text.slice(0, 120).replace(/\n/g, ' '))
  }
}
