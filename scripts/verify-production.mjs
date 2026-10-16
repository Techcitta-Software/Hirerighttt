/**
 * Compare local vs production API shape (detect stale Render deploy).
 * Usage: node scripts/verify-production.mjs
 */
const RENDER = 'https://hireright-backend-ykln.onrender.com/api/health'
const VERCEL = 'https://hire-rightt.vercel.app/api/health'
const LOCAL = 'http://127.0.0.1:8787/api/health'

async function fetchJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(90_000) })
    const text = await res.text()
    return { url, ok: res.ok, body: JSON.parse(text) }
  } catch (err) {
    return { url, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function analyze(label, data) {
  if (data.error) {
    console.log(`\n${label}: UNREACHABLE — ${data.error}`)
    return false
  }
  const b = data.body
  const modern = Boolean(b?.database && b?.models)
  const deployRef = b?.deployRef || b?.apiBuildId || '(none)'
  console.log(`\n${label}: ${data.url}`)
  console.log(`  modern API (database+models): ${modern ? 'YES ✓' : 'NO ✗ — stale deploy'}`)
  console.log(`  deployRef/apiBuildId: ${deployRef}`)
  console.log(`  llm: ${b?.llm}`)
  return modern
}

const [render, vercel, local] = await Promise.all([
  fetchJson(RENDER),
  fetchJson(VERCEL),
  fetchJson(LOCAL),
])

console.log('=== HireRight production verification ===')
const rOk = analyze('Render (direct)', render)
const vOk = analyze('Vercel (/api proxy)', vercel)
const lOk = analyze('Local', local)

if (!rOk) {
  console.log(`
Render is still on OLD code or failed to boot new code.
Fix in Render Dashboard → hireright-backend-ykln:
  1. Settings → Build: Root Directory = backend/node
  2. Branch = main, Build = npm install, Start = node index.mjs
  3. Environment: DATABASE_URL, GEMINI_API_KEY, SESSION_SECRET (32+ chars),
     CORS_ORIGINS=https://hire-rightt.vercel.app,http://localhost:5173
     PUBLIC_APP_URL=https://hire-rightt.vercel.app
  4. Manual Deploy → Clear build cache & deploy latest commit
`)
  process.exit(1)
}

if (!vOk) {
  console.log('\nVercel proxy mismatch — check vercel.json rewrite destination.')
  process.exit(1)
}

console.log('\nAll production endpoints match the modern local API.')
process.exit(0)
